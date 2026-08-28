import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import useSWR from "swr";
import { jsPDF } from "jspdf";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";
import { db, auth, storage } from "../lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { getDriveImageUrl, getDrivePdfEmbedUrl } from "../lib/driveUtils";
import { initAuth, googleSignIn, getAccessToken } from "../lib/googleAuth";
import { uploadFileToDrive, uploadFileToDriveWithToken } from "../lib/driveUpload";
import { fetchWithRetry } from "../lib/fetchWithRetry";
import { Toast } from "../components/Toast";
import { getLocalCache, setLocalCache, clearStudentCaches } from "../lib/firestoreUtils";

export function handleOpenFileLink(rawUrl: string, e?: React.MouseEvent) {
  if (e) {
    e.preventDefault();
  }
  if (!rawUrl) return;
  const trimmed = rawUrl.trim();

  // Handle base64 Data URLs (PDF, Image, etc) which iOS Safari blocks when opened directly via target="_blank"
  if (trimmed.startsWith("data:")) {
    try {
      const parts = trimmed.split(",");
      const mimeMatch = parts[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      const blob = new Blob([u8arr], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      
      const newWin = window.open(blobUrl, "_blank");
      if (!newWin || newWin.closed || typeof newWin.closed === "undefined") {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.warn("Error opening data URL:", err);
      const a = document.createElement("a");
      a.href = trimmed;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    return;
  }

  // Standard http/https URLs or plain domain URLs
  const hrefUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : `https://${trimmed}`;

  // Try window.open first with noopener,noreferrer
  const win = window.open(hrefUrl, "_blank", "noopener,noreferrer");
  if (!win || win.closed || typeof win.closed === "undefined") {
    // Fallback dynamic link click for iOS Safari iframe / popup blockers
    const a = document.createElement("a");
    a.href = hrefUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

export function getPreviewEmbedUrl(urlStr: string): string | null {
  if (!urlStr || typeof urlStr !== "string") return null;
  const trimmed = urlStr.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;

  // Google Drive File (/file/d/FILE_ID)
  const driveFileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFileMatch && driveFileMatch[1]) {
    return `https://drive.google.com/file/d/${driveFileMatch[1]}/preview`;
  }

  // Google Drive open?id=FILE_ID
  const driveIdMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (trimmed.includes("drive.google.com") && driveIdMatch && driveIdMatch[1]) {
    return `https://drive.google.com/file/d/${driveIdMatch[1]}/preview`;
  }

  // Google Docs
  const docsMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch && docsMatch[1]) {
    return `https://docs.google.com/document/d/${docsMatch[1]}/preview`;
  }

  // Google Sheets
  const sheetsMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch && sheetsMatch[1]) {
    return `https://docs.google.com/spreadsheets/d/${sheetsMatch[1]}/preview`;
  }

  // Google Slides
  const slidesMatch = trimmed.match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  if (slidesMatch && slidesMatch[1]) {
    return `https://docs.google.com/presentation/d/${slidesMatch[1]}/embed?start=false&loop=false`;
  }

  // YouTube
  const ytMatch = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([a-zA-Z0-9_-]+)/);
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube.com/embed/${ytMatch[1]}`;
  }

  return trimmed;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}


function dispatchIfQuotaError(e) {
  const msg = e && e.message ? e.message.toLowerCase() : String(e).toLowerCase();
  if (msg.includes('quota') || msg.includes('resource-exhausted') || msg.includes('exceeded')) {
    window.dispatchEvent(new CustomEvent('firestore-quota-exceeded'));
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  
  if (errInfo.error && errInfo.error.toLowerCase().includes("quota")) {
    console.warn("Firestore Quota Exceeded:", errInfo.path);
    dispatchIfQuotaError(errInfo.error);
    return;
  }
  console.warn('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Helper for session usage tracking
const trackUsage = (reads = 0, writes = 0) => {
  try {
    const stats = JSON.parse(
      sessionStorage.getItem("firas_usage_stats") || '{"reads":0,"writes":0}',
    );
    stats.reads += reads;
    stats.writes += writes;
    sessionStorage.setItem("firas_usage_stats", JSON.stringify(stats));
    try {
      const event = document.createEvent('Event');
      event.initEvent('usage-updated', true, true);
      window.dispatchEvent(event);
    } catch (e) {
      console.warn("Failed to dispatch usage-updated event", e);
    }
  } catch (e) {
    console.warn("Kesalahan statistik penggunaan:", e);
  }
};

// Helper to get name initials for profile avatar
const getInitials = (name: string) => {
  if (!name) return "S";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return parts[0].charAt(0).toUpperCase();
};
import {
  LayoutDashboard,
  Home,
  BarChart3,
  MonitorPlay,
  TrendingUp,
  Trophy,
  ChevronDown,
  Calendar,
  LineChart,
  FileEdit,
  FileText,
  Award,
  BookOpen, GraduationCap,
  LogOut, Power,
  Menu,
  X,
  User,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ArrowRight,
  Bell,
  ClipboardList,
  Timer,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Volume2,
  AlertOctagon,
  Info,
  RotateCcw,
  RefreshCw,
  Trash2,
  MessageSquare,
  MessageCircle,
  Send,
  Link,
  Search,
  Camera,
  Quote,
  Phone,
  MapPin,
  Moon,
  Globe2,
  Gamepad2,
  Target,
  Lightbulb,
  AlignLeft,
  ShieldCheck,
  ShieldAlert,
  Flag,
  AlertTriangle,
  Check,
  ArrowLeft,
  Monitor as MonitorIcon,
  Lock as LockIcon,
  Edit3,
  Users,
  Building2,
  Activity,
  HeartPulse,
  ChevronUp,
  Sliders,
  Hourglass,
  Download,
  Filter,
  Star,
  CheckSquare,
  History,
  Maximize2,
  MoreVertical,
  ExternalLink,
  Upload,
  CheckCircle,
  Eye,
  EyeOff,
  LayoutGrid,
  Clipboard,
  Image as ImageIcon,
  Plus,
  ArrowUp,
  ArrowDown,
  FileCheck,
  Layers,
} from "lucide-react";

import { motion, AnimatePresence } from "motion/react";
import { NotificationModal } from "../components/NotificationModal";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const MOCK_EXAMS = [
  {
    id: "ujian-sejarah-01",
    title: "Latihan Ujian PAT Sejarah Indonesia",
    subject: "Sejarah Indonesia",
    category: "Pilihan Ganda",
    duration: 900, // 15 menit dalam detik
    kkm: 75,
    questions: [
      {
        text: "Siapakah tokoh yang membacakan teks proklamasi kemerdekaan Republik Indonesia pada tanggal 17 Agustus 1945?",
        options: [
          "Drs. Moh. Hatta",
          "Ir. Soekarno",
          "Sutan Syahrir",
          "Achmad Soebardjo",
          "Sayuti Melik"
        ],
        correctIndex: 1
      },
      {
        text: "Pertempuran Ambarawa yang dipimpin oleh Letkol Isdiman kemudian dilanjutkan oleh Kolonel Sudirman menorehkan kemenangan heroik yang diperingati sebagai hari...",
        options: [
          "Kesaktian Pancasila",
          "Hari Ibu",
          "Hari Juang Kartika (TNI AD)",
          "Hari Pahlawan",
          "Hari Kebangkitan Nasional"
        ],
        correctIndex: 2
      },
      {
        text: "Perjanjian pertama antara Indonesia dan Belanda setelah proklamasi kemerdekaan untuk membahas status kedaulatan diadakan di...",
        options: [
          "Perjanjian Linggajati",
          "Perjanjian Renville",
          "Perjanjian Roem-Royen",
          "Konferensi Meja Bundar",
          "Perjanjian Salatiga"
        ],
        correctIndex: 0
      },
      {
        text: "Tokoh pemuda yang merumuskan naskah proklamasi dengan mengetik teks yang telah ditulis tangan oleh Bung Karno adalah...",
        options: [
          "Sukarni",
          "B.M. Diah",
          "Sayuti Melik",
          "Radjiman Wedyodiningrat",
          "Wikana"
        ],
        correctIndex: 2
      },
      {
        text: "Belanda secara resmi mengakui kedaulatan Republik Indonesia Serikat (RIS) pada tanggal 27 Desember 1949 melalui kesepakatan...",
        options: [
          "Perjanjian Renville",
          "Konferensi Meja Bundar (KMB)",
          "Perjanjian Roem-Royen",
          "Perundingan Kaliurang",
          "Perjanjian Linggajati"
        ],
        correctIndex: 1
      }
    ]
  },
  {
    id: "ujian-matematika-01",
    title: "Ulangan Harian Matematika Wajib",
    subject: "Matematika",
    category: "Pilihan Ganda",
    duration: 900,
    kkm: 78,
    questions: [
      {
        text: "Turunan pertama dari fungsi f(x) = 3x^2 - 5x + 7 adalah f'(x) = ...",
        options: [
          "6x + 5",
          "6x - 5",
          "3x - 5",
          "6x^2 - 5",
          "6x"
        ],
        correctIndex: 1
      },
      {
        text: "Jika f(x) = (2x - 3)(x + 4), nilai turunan f'(1) adalah...",
        options: [
          "7",
          "9",
          "11",
          "13",
          "15"
        ],
        correctIndex: 1
      },
      {
        text: "Titik stasioner dari fungsi f(x) = x^2 - 4x + 5 adalah...",
        options: [
          "x = -2",
          "x = 0",
          "x = 1",
          "x = 2",
          "x = 4"
        ],
        correctIndex: 3
      },
      {
        text: "Nilai minimum fungsi f(x) = x^2 - 6x + 8 pada interval [0, 5] adalah...",
        options: [
          "8",
          "3",
          "0",
          "-1",
          "-2"
        ],
        correctIndex: 3
      },
      {
        text: "Turunan pertama dari f(x) = 2x^3 adalah f'(x) = ...",
        options: [
          "6x^2",
          "5x^2",
          "6x",
          "3x^2",
          "2x^2"
        ],
        correctIndex: 0
      }
    ]
  },
  {
    id: "ujian-inggris-01",
    title: "Ujian Simulasi UTBK SBMPTN (Literasi Bahasa Inggris)",
    subject: "Bahasa Inggris",
    category: "Pilihan Ganda",
    duration: 900,
    kkm: 75,
    questions: [
      {
        text: "Choose the synonym of the word 'Meticulous' commonly used in descriptive academic texts:",
        options: [
          "Careless",
          "Haphazard",
          "Extremely precise and careful",
          "Indifferent",
          "Sluggish"
        ],
        correctIndex: 2
      },
      {
        text: "What is the primary purpose of an Analytical Exposition text?",
        options: [
          "To retell a past historical event",
          "To entertain the readers with a fantasy story",
          "To persuade the listener/audience that something is the case",
          "To describe a specific person or place in physical details",
          "To explain how to make a cup of tea"
        ],
        correctIndex: 2
      },
      {
        text: "Find the correct passive voice of the sentence: 'The teacher evaluates the student grades regularly.'",
        options: [
          "The student grades were evaluated by the teacher regularly.",
          "The student grades are evaluated by the teacher regularly.",
          "The student grades evaluates by the teacher regularly.",
          "The teacher are evaluated by the student grades regularly.",
          "The student grades has been evaluated by the teacher regularly."
        ],
        correctIndex: 1
      },
      {
        text: "Which connector is best suited to show a contrast between two sentences?",
        options: [
          "Furthermore",
          "Therefore",
          "Consequently",
          "However",
          "In addition"
        ],
        correctIndex: 3
      },
      {
        text: "If you had prepared well for the exam, you would have passed it easily. What does this conditional sentence mean?",
        options: [
          "You prepared well and you passed.",
          "You didn't prepare well but you passed anyway.",
          "You didn't prepare well, so you did not pass the exam.",
          "You will prepare well in the future.",
          "You are preparing well right now."
        ],
        correctIndex: 2
      }
    ]
  }
];

const EMPTY_ARRAY: any[] = [];

const compressImageToFile = async (file: File, maxWidth = 1600, maxHeight = 1600, quality = 0.7): Promise<File> => {
  if (!file || !file.type || !file.type.startsWith('image/')) return file;
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const newFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(newFile);
          } else {
            resolve(file);
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

export default function DashboardStudent() {
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "confirm" | "alert" | "danger";
    onConfirm?: () => void;
    confirmText?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
  });

  const showAlert = (
    title: string,
    message: string,
    type: "alert" | "danger" = "alert",
  ) => {
    setModalConfig({ isOpen: true, title, message, type });
  };

  useEffect(() => {
    const handleQuotaExceeded = (e: any) => {
      const msg = e.detail?.message || "Kuota server harian (Firebase) telah habis. Aplikasi dapat digunakan kembali pada pukul 14.00 WIB atau jam 2 siang.";
      showAlert("Batas Kuota Harian Habis", msg, "alert");
    };
    window.addEventListener('firestore-quota-exceeded', handleQuotaExceeded as EventListener);
    return () => {
      window.removeEventListener('firestore-quota-exceeded', handleQuotaExceeded as EventListener);
    };
  }, []);

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    confirmText = "Proses",
  ) => {
    setModalConfig({
      isOpen: true,
      title,
      message,
      type: "confirm",
      onConfirm,
      confirmText,
    });
  };

  const location = useLocation();
  const navigate = useNavigate();
  const [needsDriveAuth, setNeedsDriveAuth] = useState(true);
  const [isDriveAuthLoading, setIsDriveAuthLoading] = useState(false);
  
  const [student, setStudent] = useState(() => {
    if (location.state?.student) {
      const s = location.state.student;
      localStorage.setItem("current_student", JSON.stringify(s));
      return s;
    }
    const saved = localStorage.getItem("current_student");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  useEffect(() => {
    if (!student) {
      navigate("/", { replace: true });
    }
  }, [student, navigate]);

  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    // Add a small delay to ensure everything is ready and prevent "muter-muter" feeling
    const timer = setTimeout(() => {
      setIsLoadingInitialData(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const studentData = student;

  const getSavedExamSession = () => {
    if (!student?.nisn) return null;
    const sessionStr = localStorage.getItem(`exam_state_${student.nisn}`);
    if (sessionStr) {
      try {
        const saved = JSON.parse(sessionStr);
        if (saved && saved.activeExam && !saved.examResult) {
          return saved;
        }
      } catch (e) {
        console.warn("Gagal mem-parsing saved session data:", e);
      }
    }
    return null;
  };
  
  const savedExamSession = useMemo(() => getSavedExamSession(), [student?.nisn]);

  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [selectedSubject, setSelectedSubject] = useState("Informatika");
  const [taskFilter, setTaskFilter] = useState<"semua" | "tertunda" | "selesai" | "terlambat">("semua");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleTasksCount, setVisibleTasksCount] = useState(5);
  const [viewingSubmissionId, setViewingSubmissionId] = useState<string | null>(null);
  const [viewingTugas, setViewingTugas] = useState<any>(null);
  const [isFullscreenTugasModal, setIsFullscreenTugasModal] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [currentTipIdx, setCurrentTipIdx] = useState(0);

  const [direction, setDirection] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  
  // State for profile photo editing
  const [isEditing, setIsEditing] = useState(false);
  const [tempPhotoUrl, setTempPhotoUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showPhotoWarning, setShowPhotoWarning] = useState(false);

  useEffect(() => {
    // Check if student exists and doesn't have a profilePhotoUrl
    if (student && !student.profilePhotoUrl) {
      // Show warning after a short delay (e.g., 2 seconds after initial load)
      const initialDelay = setTimeout(() => {
        setShowPhotoWarning(true);
      }, 2000);
      
      return () => clearTimeout(initialDelay);
    } else {
      setShowPhotoWarning(false);
    }
  }, [student?.profilePhotoUrl]);

  useEffect(() => {
    if (showPhotoWarning) {
      const hideTimer = setTimeout(() => {
        setShowPhotoWarning(false);
      }, 10000);
      return () => clearTimeout(hideTimer);
    }
  }, [showPhotoWarning]);

  // Sync student data if it changes in firestore (like profile image)
  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (!studentData?.id) return;
    const cacheKey = `firas_student_profile_${studentData.id}`;
    const cached = getLocalCache<any>(cacheKey, 60 * 60 * 1000);
    if (cached) {
      setStudent(cached);
      return;
    }
    const studentDoc = doc(db, "studentsByNisn", studentData.id);
    getDoc(studentDoc).then((snapshot) => {
      if (snapshot.exists()) {
        const fullData = { id: snapshot.id, ...snapshot.data() };
        setStudent(fullData);
        setLocalCache(cacheKey, fullData);
      }
    }).catch((error) => { console.warn('Firestore error:', error.message); dispatchIfQuotaError(error); });
  }, [studentData?.id]);

  // Track online/offline status efficiently (once per session to avoid write quota burn)
  useEffect(() => {
    if (!studentData?.id) return;

    const lastPresence = Number(sessionStorage.getItem("firas_presence_time") || 0);
    // Only update presence once every 60 minutes per session
    if (Date.now() - lastPresence < 60 * 60 * 1000) return;

    const updatePresence = async () => {
      try {
        await setDoc(
          doc(db, "studentsByNisn", studentData.id),
          { lastActive: new Date().toISOString() },
          { merge: true }
        );
        sessionStorage.setItem("firas_presence_time", String(Date.now()));
        trackUsage(0, 1);
      } catch (err) {
        console.warn("Gagal memperbarui status online:", err);
      }
    };

    updatePresence();
  }, [studentData?.id]);

  useEffect(() => {
    if (!student?.kelas) return;
    
    // Only fetch absensi for student's own class with TTL cache to save 95% reads
    const cacheKey = `firas_cache_absensi_${student.kelas}`;
    const cached = getLocalCache<any[]>(cacheKey, 2 * 60 * 60 * 1000);
    if (cached) {
      setAbsensiList(cached);
      return;
    }

    const q = query(collection(db, "absensi"), where("kelasRef", "==", student.kelas));
    getDocs(q).then((snapshot) => {
      const abs: any[] = [];
      snapshot.forEach((doc) => {
        abs.push({ id: doc.id, ...doc.data() });
      });
      setAbsensiList(abs);
      setLocalCache(cacheKey, abs);
    }).catch((error) => { console.warn('Firestore error:', error.message); dispatchIfQuotaError(error); });
  }, [student?.kelas]);

  const [chaptersList, setChaptersList] = useState<any[]>([]);

  useEffect(() => {
    const cacheKey = 'firas_cache_chapters';
    const cached = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
    if (cached) {
      setChaptersList(cached);
      return;
    }
    getDocs(collection(db, 'chapters')).then((snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setChaptersList(list);
      setLocalCache(cacheKey, list);
    }).catch((error) => { console.warn('Firestore error:', error.message); dispatchIfQuotaError(error); });
  }, []);

  const handleMenuChange = (id: string, index: number) => {
    const currentIndex = menus.findIndex((m) => m.id === activeMenu);
    setDirection(index > currentIndex ? 1 : -1);
    setActiveMenu(id);
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleLogout = async () => {
    if (studentData?.id) {
      // Fire and forget Firestore update so slow or offline connections do not block the logout flow
      setDoc(
        doc(db, "studentsByNisn", studentData.id),
        { lastActive: null },
        { merge: true }
      ).catch((e) => {
        console.warn("Gagal membersihkan status online saat logout:", e);
      });
      try {
        trackUsage(0, 1);
      } catch (e) { console.warn("Error parsing stored data:", e); }
    }
    localStorage.removeItem("current_student");
    navigate("/", { replace: true });
  };
  
  const [tokenInput, setTokenInput] = useState("");
  const [selectedExamForToken, setSelectedExamForToken] = useState<any | null>(null);
  const [examTokenError, setExamTokenError] = useState("");
  
  // Custom dialogs/toasts for quick dashboard links
  const [isSchoolInfoOpen, setIsSchoolInfoOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [syncToastMessage, setSyncToastMessage] = useState("");

  // Profile edit form state variables
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editParentPhone, setEditParentPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPhoto, setEditPhoto] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  
  // Data Pribadi States
  const [isEditingPribadi, setIsEditingPribadi] = useState(false);
  const [editTempatLahir, setEditTempatLahir] = useState("");
  const [editTanggalLahir, setEditTanggalLahir] = useState("");
  const [editJenisKelamin, setEditJenisKelamin] = useState("");
  const [editAgama, setEditAgama] = useState("");
  const [editKewarganegaraan, setEditKewarganegaraan] = useState("");
  
  // Tentang Saya States
  const [isEditingTentang, setIsEditingTentang] = useState(false);
  const [editHobi, setEditHobi] = useState("");
  const [editCitaCita, setEditCitaCita] = useState("");
  const [editMotto, setEditMotto] = useState("");
  const [editDeskripsi, setEditDeskripsi] = useState("");

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (student) {
      setEditName(student.displayName || student.name || "");
      setEditPhone(student.phoneNumber || "");
      setEditParentPhone(student.parentPhoneNumber || "");
      setEditAddress(student.alamat || "");
      setEditPhoto(student.profilePhotoUrl || "");
      
      setEditTempatLahir(student.tempatLahir || "");
      setEditTanggalLahir(student.tanggalLahir || "");
      setEditJenisKelamin(student.jenisKelamin || "");
      setEditAgama(student.agama || "");
      setEditKewarganegaraan(student.kewarganegaraan || "");
      
      setEditHobi(student.hobi || "");
      setEditCitaCita(student.citaCita || "");
      setEditMotto(student.motto || "");
      setEditDeskripsi(student.deskripsi || "");
    }
  }, [student]);

  const handleSaveProfileData = async (section: "pribadi" | "tentang" | "all") => {
    if (!student?.id) return;
    setIsSavingProfile(true);
    try {
      const updatedData: any = {};
      
      if (section === "pribadi" || section === "all") {
        updatedData.name = editName;
        updatedData.tempatLahir = editTempatLahir;
        updatedData.tanggalLahir = editTanggalLahir;
        updatedData.jenisKelamin = editJenisKelamin;
        updatedData.agama = editAgama;
        updatedData.kewarganegaraan = editKewarganegaraan;
      }
      
      if (section === "tentang" || section === "all") {
        updatedData.hobi = editHobi;
        updatedData.citaCita = editCitaCita;
        updatedData.motto = editMotto;
        updatedData.deskripsi = editDeskripsi;
      }

      await setDoc(doc(db, "studentsByNisn", student.id), updatedData, { merge: true });
      setStudent({ ...student, ...updatedData });
      setSyncToastMessage("Data profil berhasil diperbarui!");
      setTimeout(() => setSyncToastMessage(""), 3000);
      
      if (section === "pribadi") setIsEditingPribadi(false);
      if (section === "tentang") setIsEditingTentang(false);
    } catch (error) {
      console.warn("Gagal menyimpan profil:", error);
      alert("Gagal menyimpan profil. Silakan coba lagi.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  // State for upload modal & multi-page scan
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [submissionTab, setSubmissionTab] = useState<"scan" | "link">("scan");
  const [scannedPages, setScannedPages] = useState<string[]>([]);
  const [isProcessingScan, setIsProcessingScan] = useState(false);
  const [previewModalIndex, setPreviewModalIndex] = useState<number | null>(null);
  const fileInputCameraRef = useRef<HTMLInputElement>(null);
  const fileInputGalleryRef = useRef<HTMLInputElement>(null);
  const [showDriveAuthNotice, setShowDriveAuthNotice] = useState(false);
  const [showDriveSuccessConnected, setShowDriveSuccessConnected] = useState(false);
  const [showJSONErrorExplain, setShowJSONErrorExplain] = useState(false);
  
  // Elegant Success Overlay State
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [successTugasMateri, setSuccessTugasMateri] = useState<string>("");

  // Scanner helper functions (Image compression & Multi-page management)
  const compressScannedImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;
          const maxDim = 1400; // Optimal for sharp handwriting at ~100-150KB
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, width, height);
          }
          const compressed = canvas.toDataURL("image/jpeg", 0.78);
          resolve(compressed);
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAddScannedFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsProcessingScan(true);
    setUploadMessage({ text: "Memproses gambar...", type: "warning" });
    try {
      const newPages: string[] = [];
      let hasVideoError = false;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Cek secara ketat agar tidak ada video yang lolos
        if (file.type.startsWith("video/") || file.name.toLowerCase().match(/\.(mp4|mov|avi|wmv|flv|mkv)$/)) {
          console.warn("Video ditolak:", file.name);
          hasVideoError = true;
          continue; // Lewati file video
        }

        // Allow empty type (some Android browsers) or any image type
        if (file.type.startsWith("image/") || file.type === "") {
          const compressed = await compressScannedImage(file);
          newPages.push(compressed);
        } else {
            console.warn("Tipe file tidak didukung:", file.type);
        }
      }
      
      if (hasVideoError) {
        setUploadMessage({
          text: "Format Video tidak diizinkan! Harap hanya memfoto lembar catatan.",
          type: "error",
        });
      } else if (newPages.length > 0) {
        setScannedPages((prev) => [...prev, ...newPages]);
        setUploadMessage({
          text: `✅ Berhasil menambahkan ${newPages.length} lembar catatan!`,
          type: "success",
        });
      } else {
        setUploadMessage({
          text: "Tidak ada gambar yang valid untuk diproses.",
          type: "error",
        });
      }
    } catch (err: any) {
      console.warn("Gagal memproses gambar catatan:", err);
      setUploadMessage({
        text: "Gagal memproses lembar catatan. Coba pilih foto lain.",
        type: "error",
      });
    } finally {
      setIsProcessingScan(false);
    }
  };

  const handleRemoveScannedPage = (index: number) => {
    setScannedPages((prev) => prev.filter((_, i) => i !== index));
    if (previewModalIndex === index) {
      setPreviewModalIndex(null);
    }
  };

  const handleMoveScannedPage = (index: number, direction: "up" | "down") => {
    setScannedPages((prev) => {
      const updated = [...prev];
      const targetIdx = direction === "up" ? index - 1 : index + 1;
      if (targetIdx < 0 || targetIdx >= updated.length) return prev;
      const temp = updated[index];
      updated[index] = updated[targetIdx];
      updated[targetIdx] = temp;
      return updated;
    });
  };

  // No longer checking Google Drive auth for students as they submit via pasted links
  const [selectedTugas, setSelectedTugas] = useState<any>(null);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: 'success' | 'error' | 'warning' } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Link Paste & Ref helper states
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [showPasteDialog, setShowPasteDialog] = useState(false);
  const [pasteDialogText, setPasteDialogText] = useState("");

  const handlePasteClick = async () => {
    if (linkInputRef.current) {
      linkInputRef.current.focus();
    }

    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          setSelectedFile(text.trim());
          setUploadMessage({ text: "Tautan berhasil ditempel!", type: "success" });
          return;
        }
      }
    } catch (err) {
      console.warn("Clipboard API readText blocked or permission denied:", err);
    }

    // Fallback if clipboard API is restricted by browser or iframe
    setPasteDialogText("");
    setShowPasteDialog(true);
  };

  // Link Access Checker State (Google Drive, CamScanner, Canva, OneDrive, Dropbox, Web)
  const [isCheckingDriveAccess, setIsCheckingDriveAccess] = useState<boolean>(false);
  const [driveAccessResult, setDriveAccessResult] = useState<{
    isDrive?: boolean;
    accessible: boolean;
    provider?: string;
    providerName?: string;
    message: string;
  } | null>(null);

  // Auto-detect link accessibility & provider permission when link changes
  useEffect(() => {
    if (!selectedFile || !selectedFile.trim() || !selectedFile.trim().startsWith("http")) {
      setDriveAccessResult(null);
      setIsCheckingDriveAccess(false);
      return;
    }

    const trimmedUrl = selectedFile.trim();

    setIsCheckingDriveAccess(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithRetry("/api/check-drive-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmedUrl }),
        });
        const data = await res.json();
        setDriveAccessResult(data);
      } catch (err) {
        console.warn("Error checking link access:", err);
        setDriveAccessResult({
          accessible: true,
          providerName: "Tautan Web",
          message: "Periksa sambungan internet untuk verifikasi otomatis.",
        });
      } finally {
        setIsCheckingDriveAccess(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [selectedFile]);
  
  // Profile Photo Modal State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProfileLinkDisabled, setIsProfileLinkDisabled] = useState(false);
  
  // New State for Notifications Popup
  const [showNotifications, setShowNotifications] = useState<any[]>([]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [allNotifications, setAllNotifications] = useState<any[]>([]);
  const [absensiList, setAbsensiList] = useState<any[]>([]);
  const [rubric, setRubric] = useState<any>({
    kehadiran: 20,
    tugas: 50,
    uts: 10,
    uas: 20,
  });

  // Fetch Grading Rubric from Firestore with cache
  useEffect(() => {
    const cacheKey = "firas_cache_rubric";
    const cached = getLocalCache<any>(cacheKey, 60 * 60 * 1000);
    if (cached) {
      setRubric(cached);
      return;
    }
    getDoc(doc(db, "config", "grading_rubric")).then((docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const r = {
            kehadiran: Number(data.kehadiran) ?? 20,
            tugas: Number(data.tugas) ?? 50,
            uts: Number(data.uts) ?? 10,
            uas: Number(data.uas) ?? 20,
          };
          setRubric(r);
          setLocalCache(cacheKey, r);
        }
      }).catch((error) => { console.warn('Gagal mengambil rubrik:', error); dispatchIfQuotaError(error); });
  }, []);

  // Announcement interaction
  const [viewedAnnouncement, setViewedAnnouncement] = useState<any>(null);

  // Load exam history from localStorage
  const [examHistoryList, setExamHistoryList] = useState<any[]>([]);

  // CBT Ujian Online States
  const [activeExam, setActiveExam] = useState<any | null>(null);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);
  const [examAnswers, setExamAnswers] = useState<Record<number, number>>({});
  const [examFlags, setExamFlags] = useState<Record<number, boolean>>({});
  const [examTimer, setExamTimer] = useState<number>(0);
  const [examResult, setExamResult] = useState<any | null>(null);
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState<boolean>(false);
  const [isQuestionNavOpen, setIsQuestionNavOpen] = useState<boolean>(window.innerWidth >= 1024);
  const [examFontSize, setExamFontSize] = useState<"normal" | "large" | "xlarge">("normal");
  const [isViolationSirening, setIsViolationSirening] = useState<boolean>(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState<boolean>(true);
  const [examViolationCount, setExamViolationCount] = useState<number>(0);
  const [showExitWarningModal, setShowExitWarningModal] = useState<boolean>(false);
  const [pendingNavAction, setPendingNavAction] = useState<any>(null);
  const [unansweredWarningList, setUnansweredWarningList] = useState<number[] | null>(null);
  const [showEmbeddedPdf, setShowEmbeddedPdf] = useState<boolean>(false);

  const handleTrySubmit = () => {
    if (!activeExam || !activeExam.questions) return;
    const unanswered: number[] = [];
    activeExam.questions.forEach((_: any, idx: number) => {
      if (examAnswers[idx] === undefined) {
        unanswered.push(idx);
      }
    });
    if (unanswered.length > 0) {
      setUnansweredWarningList(unanswered);
    } else {
      setIsSubmitConfirmOpen(true);
    }
  };

  // WhatsApp Share Modal States
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waParentPhone, setWaParentPhone] = useState("");
  const [waDraftMessage, setWaDraftMessage] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(false);

  // Materials View States
  const [materialsList, setMaterialsList] = useState<any[]>([]);
  const [materialsProgress, setMaterialsProgress] = useState<Record<string, any>>({});
  const [materiSearch, setMateriSearch] = useState("");
  const [materiTab, setMateriTab] = useState("semua"); // "semua", "bab", "favorit"
  const [isMateriFilterOpen, setIsMateriFilterOpen] = useState(false);
  const [isTipsModalOpen, setIsTipsModalOpen] = useState(false);



  const [dismissedStatusDate, setDismissedStatusDate] = useState<string | null>(() => {
    const saved = localStorage.getItem("current_student");
    if (saved) {
      try {
        const studentObj = JSON.parse(saved);
        if (studentObj?.nisn) {
          return localStorage.getItem(`dismissed_status_date_${studentObj.nisn}`);
        }
      } catch (e) { console.warn("Error parsing stored data:", e); }
    }
    return null;
  });

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (student?.nisn) {
      setDismissedStatusDate(localStorage.getItem(`dismissed_status_date_${student.nisn}`));
    }
  }, [student?.nisn]);

  const handleDismissStatusBanner = (dateToDismiss: string) => {
    if (student?.nisn) {
      localStorage.setItem(`dismissed_status_date_${student.nisn}`, dateToDismiss);
      setDismissedStatusDate(dateToDismiss);
    }
  };

  const formattedToday = useMemo(() => {
    const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const monthNames = [
      "Januari", "Februari", "Maret", "April", "Mei", "Juni",
      "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    const d = new Date();
    const dayName = dayNames[d.getDay()];
    const dateNum = d.getDate();
    const monthName = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${dayName}, ${dateNum} ${monthName} ${year}`;
  }, []);

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    const cacheKey = "firas_cache_materials";
    const cached = getLocalCache<any[]>(cacheKey, 4 * 60 * 60 * 1000);
    if (cached) {
      setMaterialsList(cached);
      return;
    }
    getDocs(collection(db, "materials")).then((snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      const sorted = list.sort((a, b) => (a.order || 0) - (b.order || 0));
      setMaterialsList(sorted);
      setLocalCache(cacheKey, sorted);
    }).catch((error) => { dispatchIfQuotaError(error); handleFirestoreError(error, OperationType.LIST, "materials");
    });
  }, []);

  useEffect(() => {
    if (!student?.id) return;
    const cacheKey = `firas_cache_progress_${student.id}`;
    const cached = getLocalCache<Record<string, any>>(cacheKey, 1 * 60 * 60 * 1000);
    if (cached) {
      setMaterialsProgress(cached);
      return;
    }
    const q = query(collection(db, "material_progress"), where("studentId", "==", student.id));
    getDocs(q).then((snapshot) => {
      const progress: Record<string, any> = {};
      snapshot.forEach((doc) => {
        const data = doc.data();
        progress[data.materialId] = { id: doc.id, ...data };
      });
      setMaterialsProgress(progress);
      setLocalCache(cacheKey, progress);
    }).catch((error) => { dispatchIfQuotaError(error); handleFirestoreError(error, OperationType.LIST, "material_progress");
    });
  }, [student?.id]);

  const handleToggleFavoriteMaterial = async (materialId: string) => {
    if (!student?.id) return;
    const progressId = `${student.id}_${materialId}`;
    const current = materialsProgress[materialId];
    try {
      await setDoc(doc(db, "material_progress", progressId), {
        studentId: student.id,
        materialId,
        isFavorite: !current?.isFavorite,
        status: current?.status || "Belum Dimulai",
        lastAccessed: new Date().toISOString()
      }, { merge: true });
      trackUsage(0, 1);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `material_progress/${progressId}`);
    }
  };

  const handleOpenMaterial = (materialId: string, driveUrl: string) => {
    if (!driveUrl) return;

    // Ensure valid URL with https:// protocol
    let formattedUrl = driveUrl.trim();
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = "https://" + formattedUrl;
    }

    // Open tab IMMEDIATELY synchronously before async calls to bypass Safari/iOS popup blocker
    let newWindow: Window | null = null;
    try {
      newWindow = window.open(formattedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.warn("window.open failed, trying element click fallback", err);
    }

    if (!newWindow || newWindow.closed || typeof newWindow.closed === "undefined") {
      // Direct anchor element click fallback for Apple/iOS browser security policies
      const link = document.createElement("a");
      link.href = formattedUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    if (!student?.id) return;
    const progressId = `${student.id}_${materialId}`;
    const current = materialsProgress[materialId];
    
    try {
      // Logic: Increment progress by 20% each click
      const currentPercentage = current?.percentage || 0;
      let nextPercentage = currentPercentage + 20;
      if (nextPercentage > 100) nextPercentage = 100;
      
      let nextStatus = "Sedang Dipelajari";
      if (nextPercentage === 100) {
        nextStatus = "Selesai";
      }

      setDoc(doc(db, "material_progress", progressId), {
        studentId: student.id,
        materialId,
        status: nextStatus,
        percentage: nextPercentage,
        lastAccessed: new Date().toISOString()
      }, { merge: true }).catch((e) => {
        handleFirestoreError(e, OperationType.WRITE, `material_progress/${progressId}`);
      });

      trackUsage(0, 1);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `material_progress/${progressId}`);
    }
  };

  const handleUpdateMaterialStatus = async (materialId: string, status: "Belum Dimulai" | "Sedang Dipelajari" | "Selesai") => {
    if (!student?.id) return;
    const progressId = `${student.id}_${materialId}`;
    try {
      const percentage = status === "Selesai" ? 100 : (status === "Sedang Dipelajari" ? (materialsProgress[materialId]?.percentage || 20) : 0);
      await setDoc(doc(db, "material_progress", progressId), {
        studentId: student.id,
        materialId,
        status,
        percentage: status === "Belum Dimulai" ? 0 : percentage,
        lastAccessed: new Date().toISOString()
      }, { merge: true });
      trackUsage(0, 1);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `material_progress/${progressId}`);
    }
  };

  const classMaterials = useMemo(() => {
    if (!student?.kelas) return materialsList;
    return materialsList.filter(m => !m.kelasRef || m.kelasRef === student.kelas);
  }, [materialsList, student?.kelas]);

  const materialStats = useMemo(() => {
    const total = classMaterials.length;
    const progressValues = Object.values(materialsProgress) as any[];
    const selesai = progressValues.filter(p => {
      const isClassMateri = classMaterials.some(m => m.id === p.materialId);
      return isClassMateri && p.status === "Selesai";
    }).length;
    const sedang = progressValues.filter(p => {
      const isClassMateri = classMaterials.some(m => m.id === p.materialId);
      return isClassMateri && p.status === "Sedang Dipelajari";
    }).length;
    const belum = total - selesai - sedang;
    const percentage = total > 0 ? Math.round((selesai / total) * 100) : 0;
    
    return { total, selesai, sedang, belum, percentage };
  }, [classMaterials, materialsProgress]);

  const filteredMaterials = useMemo(() => {
    let list = [...classMaterials];
    
    if (materiTab === "favorit") {
      list = list.filter(m => materialsProgress[m.id]?.isFavorite);
    }
    
    return list;
  }, [classMaterials, materiTab, materialsProgress]);

  const handleShareToWaParent = () => {
    if (!student) return;
    
    const stats = attendanceSummary || { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, Dispen: 0, totalMeetings: 0, percentage: "0" };
    
    // Construct grades report
    const gradedItems = unifiedAcademicItems.filter(item => item.nilai !== "");
    const totalScore = gradedItems.reduce((acc, curr) => acc + Number(curr.nilai), 0);
    const avg = gradedItems.length > 0 ? (totalScore / gradedItems.length).toFixed(1) : "Belum ada Nilai";

    const gradesText = gradedItems.length > 0
      ? gradedItems.map(item => `• ${item.type} - ${item.title}: *${item.nilai}*`).join("\n")
      : "- Belum ada entri nilai tugas atau ujian";

    const text = `*LAPORAN PERKEMBANGAN BELAJAR SISWA*
*Portal Akademik SMAN Belajar*

Disampaikan Kepada Yth. Bapak/Ibu Orang Tua/Wali dari:
• *Nama Siswa:* ${student.displayName}
• *NISN:* ${student.nisn}
• *Kelas:* ${student.kelas}

*1. RINGKASAN KEHADIRAN (PRESENSI)*
• Total Hari Sekolah: ${stats.totalMeetings} Pertemuan
• Hadir: ${stats.Hadir} hari
• Sakit: ${stats.Sakit} hari
• Izin: ${stats.Izin} hari
• Alpa: ${stats.Alpa} hari
• Dispen: ${stats.Dispen} hari
• *Persentase Kehadiran:* *${stats.percentage}%*

*2. DETAIL NILAI TUGAS & UJIAN (CBT)*
${gradesText}

• *Rata-Rata Nilai (IPK):* *${avg}*

_Laporan dikirim secara mandiri oleh Siswa untuk berbagi progres belajar. Terima kasih atas dukungan dan doa Ayah/Bunda selalu._`;

    setWaDraftMessage(text);
    setWaParentPhone(student.parentPhone || "628"); // Pre-populate and allow edit
    setIsWaModalOpen(true);
    setCopiedIndex(false);
  };

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncingResults, setIsSyncingResults] = useState(false);

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const syncPendingResults = async () => {
    if (!student?.nisn || !isOnline || isSyncingResults) return;
    
    const syncKey = `pending_exam_sync_${student.nisn}`;
    const pending = JSON.parse(localStorage.getItem(syncKey) || "[]");
    if (pending.length === 0) return;

    setIsSyncingResults(true);
    const remaining = [];
    
    for (const result of pending) {
      try {
        const finalGradeRef = doc(db, "final_grades", `${result.examId}_${student.nisn}`);
        await setDoc(finalGradeRef, {
          ...result,
          assignmentId: result.examId,
          nisn: student.nisn,
          type: "exam",
        });
        trackUsage(0, 1);
      } catch (err) {
        console.warn("Gagal sinkronisasi nilai tertunda:", err);
        remaining.push(result);
      }
    }

    localStorage.setItem(syncKey, JSON.stringify(remaining));
    setIsSyncingResults(false);
  };

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (isOnline && student?.id) {
      syncPendingResults();
    }
  }, [isOnline, student?.id]);

  // Refs for audio / timer
  const sirenAudioRef = useRef<HTMLAudioElement | null>(null);
  const sirenTimeoutRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sirenOsc1Ref = useRef<OscillatorNode | null>(null);
  const sirenOsc2Ref = useRef<OscillatorNode | null>(null);
  const sirenGainRef = useRef<GainNode | null>(null);
  const sirenIntervalRef = useRef<any>(null);
  const vibrationIntervalRef = useRef<any>(null);

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (!student?.nisn) return;
    const historyKey = `ujian_history_${student.nisn}`;
    try {
      const stored = JSON.parse(localStorage.getItem(historyKey) || "[]");
      setExamHistoryList(stored);

      // Restore active exam if any
      const sessionStr = localStorage.getItem(`exam_state_${student.nisn}`);
      if (sessionStr) {
        const saved = JSON.parse(sessionStr);
        if (saved && saved.activeExam && !saved.examResult) {
          setActiveExam(saved.activeExam);
          setCurrentQuestionIdx(saved.currentQuestionIdx || 0);
          setExamAnswers(saved.examAnswers || {});
          setExamFlags(saved.examFlags || {});
          setExamTimer(saved.examTimer);
          setExamViolationCount(saved.examViolationCount || 0);
        }
      }
    } catch (e) {
      console.warn("Gagal memuat memory ujian:", e);
    }
  }, [student?.nisn]);

  // Sync CBT Exam state to local storage when active
  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (!student?.nisn || !activeExam || examResult) return;
    const stateToSave = {
      activeExam,
      currentQuestionIdx,
      examAnswers,
      examFlags,
      examTimer,
      examViolationCount,
    };
    localStorage.setItem(`exam_state_${student.nisn}`, JSON.stringify(stateToSave));
  }, [activeExam, currentQuestionIdx, examAnswers, examFlags, examTimer, examResult, examViolationCount, student?.nisn]);

  const startSiren = () => {
    setExamViolationCount((prev) => {
      const updated = prev + 1;
      
      // Persist to local storage immediately
      if (student?.nisn && activeExam) {
        const stateKey = `exam_state_${student.nisn}`;
        try {
          const savedStr = localStorage.getItem(stateKey);
          if (savedStr) {
            const parsed = JSON.parse(savedStr);
            parsed.examViolationCount = updated;
            localStorage.setItem(stateKey, JSON.stringify(parsed));
          }
        } catch (e) {
          console.warn("Gagal mengupdate local storage exam_state:", e);
        }

        // Write directly to Firestore "final_grades" matching the teacher view as a Penalty / Pelanggaran
        const finalGradeRef = doc(db, "final_grades", `${activeExam.id}_${student.nisn}`);
        setDoc(finalGradeRef, {
          examId: activeExam.id,
          assignmentId: activeExam.id,
          examTitle: activeExam.title,
          subject: activeExam.subject,
          bab: activeExam.bab || "",
          violationCount: updated,
          violationsCount: updated,
          nisn: student.nisn || "",
          type: "exam",
          status: "melanggar", // mark status as violation / melanggar
          updatedAt: new Date().toISOString(),
        }, { merge: true }).catch((err) => {
          console.warn("Gagal mencatat penalti pelanggaran ke Firestore:", err);
        });
      }

      return updated;
    });
    try {
      if (sirenIntervalRef.current) return;

      if (sirenTimeoutRef.current) {
        clearTimeout(sirenTimeoutRef.current);
        sirenTimeoutRef.current = null;
      }

      // Aktifkan getaran fisik berulang ekstrem untuk perangkat smartphone guna menerobos setting volume 0/senyap
      if (navigator.vibrate) {
        navigator.vibrate([1000, 300, 1000, 300, 1000]);
        vibrationIntervalRef.current = setInterval(() => {
          if (navigator.vibrate) {
            navigator.vibrate([1000, 300, 1000]);
          }
        }, 2500);
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;
      const gainNode = ctx.createGain();
      // Meningkatkan gain dari 5.0 ke 8.0 (800% kekuatan sinyal) agar suara sirine terdengar sangat lantang dan bising
      gainNode.gain.setValueAtTime(8.0, ctx.currentTime);
      gainNode.connect(ctx.destination);
      sirenGainRef.current = gainNode;

      const osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.setValueAtTime(800, ctx.currentTime);
      osc1.connect(gainNode);
      osc1.start();
      sirenOsc1Ref.current = osc1;

      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.setValueAtTime(1200, ctx.currentTime);
      osc2.connect(gainNode);
      osc2.start();
      sirenOsc2Ref.current = osc2;

      let pitchState = false;
      sirenIntervalRef.current = setInterval(() => {
        if (ctx.state === "suspended") ctx.resume();
        const now = ctx.currentTime;
        if (pitchState) {
          osc1.frequency.setValueAtTime(600, now);
          osc2.frequency.setValueAtTime(900, now);
        } else {
          osc1.frequency.setValueAtTime(1100, now);
          osc2.frequency.setValueAtTime(1400, now);
        }
        pitchState = !pitchState;
      }, 200);

      sirenTimeoutRef.current = setTimeout(() => {
        stopSiren();
        setIsViolationSirening(false);
      }, 5000);

    } catch (err) {
      console.warn("Gagal memulai sirine:", err);
    }
  };

  const stopSiren = () => {
    try {
      if (sirenTimeoutRef.current) {
        clearTimeout(sirenTimeoutRef.current);
        sirenTimeoutRef.current = null;
      }
      if (sirenIntervalRef.current) {
        clearInterval(sirenIntervalRef.current);
        sirenIntervalRef.current = null;
      }
      if (vibrationIntervalRef.current) {
        clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = null;
      }
      if (navigator.vibrate) {
        navigator.vibrate(0); // Matikan semua getaran bising
      }
      if (sirenOsc1Ref.current) {
        sirenOsc1Ref.current.stop();
        sirenOsc1Ref.current.disconnect();
        sirenOsc1Ref.current = null;
      }
      if (sirenOsc2Ref.current) {
        sirenOsc2Ref.current.stop();
        sirenOsc2Ref.current.disconnect();
        sirenOsc2Ref.current = null;
      }
      if (sirenGainRef.current) {
        sirenGainRef.current.disconnect();
        sirenGainRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    } catch (e) { console.warn("Error parsing stored data:", e); }
  };

  const handleStartExam = (exam: any) => {
    setActiveExam(exam);
    setCurrentQuestionIdx(0);
    setExamAnswers({});
    setExamFlags({});
    setExamTimer(exam.duration);
    setExamResult(null);
    setExamViolationCount(0);
    setIsFullscreenActive(true);
    
    // Request Fullscreen Mode automatically
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch((err) => console.log("Layar penuh ditolak:", err));
      } else if ((el as any).webkitRequestFullscreen) {
        (el as any).webkitRequestFullscreen();
      }
    } catch (err) {
      console.warn("Fullscreen error:", err);
    }
  };

  const handleAttemptStartExam = (exam: any) => {
    if (exam.token) {
      setSelectedExamForToken(exam);
      setTokenInput("");
      setExamTokenError("");
    } else {
      handleStartExam(exam);
    }
  };

  const handleVerifyExamToken = () => {
    if (!selectedExamForToken) return;
    if (tokenInput.trim().toUpperCase() === selectedExamForToken.token.toUpperCase()) {
      const examToStart = selectedExamForToken;
      setSelectedExamForToken(null);
      handleStartExam(examToStart);
    } else {
      setExamTokenError("Token ujian salah. Silakan minta pada Guru pengawas.");
    }
  };

  const handleStartRemedialExam = (exam: any) => {
    // Hapus backup state ujian agar pengerjaan remedial dimulai dari awal secara bersih
    localStorage.removeItem(`exam_state_${student?.nisn}`);
    
    if (student?.nisn) {
      const updatedHistory = examHistoryList.filter((h) => h.examId !== exam.id);
      setExamHistoryList(updatedHistory);
      localStorage.setItem(`ujian_history_${student.nisn}`, JSON.stringify(updatedHistory));
    }
    
    setExamViolationCount(0);
    setCurrentQuestionIdx(0);
    setExamAnswers({});
    setExamFlags({});
    setExamResult(null);

    handleAttemptStartExam(exam);
  };

  const examAnswersRef = useRef<Record<number, number>>({});
  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    examAnswersRef.current = examAnswers;
  }, [examAnswers]);

  const handleFinishExam = async (isTimeOut = false, forcedViolationCount?: number) => {
    setIsSubmitConfirmOpen(false);
    const answersToUse = examAnswersRef.current;
    if (!student?.nisn || !activeExam) return;

    let correctCount = 0;
    activeExam.questions.forEach((q: any, idx: number) => {
      if (answersToUse[idx] === q.correctIndex) {
        correctCount++;
      }
    });

    const totalQuestions = activeExam.questions.length;
    const baseScore = Math.round((correctCount / totalQuestions) * 100);
    const passed = baseScore >= activeExam.kkm;

    const result = {
      examId: activeExam.id,
      examTitle: activeExam.title,
      subject: activeExam.subject,
      bab: activeExam.bab || "",
      correctCount,
      totalQuestions,
      score: baseScore,
      kkm: activeExam.kkm,
      passed,
      submittedAt: new Date().toISOString(),
      wasTimeOut: isTimeOut,
      violationCount: forcedViolationCount !== undefined ? forcedViolationCount : examViolationCount,
      gradedAt: new Date().toISOString(),
      nilai: baseScore,
    };

    setExamResult(result);

    const saveToCloud = async () => {
      try {
        const finalGradeRef = doc(db, "final_grades", `${activeExam.id}_${student.nisn}`);
        await setDoc(finalGradeRef, {
          ...result,
          assignmentId: activeExam.id,
          nisn: student.nisn || "",
          type: "exam",
        });
        trackUsage(0, 1);
        if (typeof mutateFinalGrades === "function") mutateFinalGrades();
        if (typeof mutateAllFinalGrades === "function") mutateAllFinalGrades();
      } catch (err) {
        console.warn("Gagal mengupload nilai ujian, masuk ke antrean sinkronisasi:", err);
        const syncKey = `pending_exam_sync_${student.nisn}`;
        const pending = JSON.parse(localStorage.getItem(syncKey) || "[]");
        pending.push(result);
        localStorage.setItem(syncKey, JSON.stringify(pending));
      }
    };

    saveToCloud();

    try {
      const historyKey = `ujian_history_${student.nisn}`;
      const currentHistory = JSON.parse(localStorage.getItem(historyKey) || "[]");
      const updatedHistory = [result, ...currentHistory];
      localStorage.setItem(historyKey, JSON.stringify(updatedHistory));
      setExamHistoryList(updatedHistory);
      localStorage.removeItem(`exam_state_${student.nisn}`);
    } catch (e) { console.warn("Error parsing stored data:", e); }
  };

  const confirmCheatExit = async () => {
    if (!pendingNavAction) return;

    const latestViolationCount = examViolationCount + 1;
    setExamViolationCount(latestViolationCount);

    const action = pendingNavAction;
    setShowExitWarningModal(false);
    setPendingNavAction(null);

    // Auto finish active exam, passing the latest violation count with the recorded penalty
    await handleFinishExam(false, latestViolationCount);

    // Execute transition/logout
    setTimeout(async () => {
      if (action.type === "menu" && action.id !== undefined && action.index !== undefined) {
        handleMenuChange(action.id, action.index);
      } else if (action.type === "logout" || action.type === "logout_attempt") {
        await handleLogout();
      } else if (action.type === "popstate_attempt" || action.type === "sidebar_attempt") {
        handleMenuChange("dashboard", 0);
      }
    }, 300);
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (!activeExam || examResult) return;
    if (examTimer <= 0) {
      handleFinishExam(true);
      return;
    }
    const timerId = setTimeout(() => {
      setExamTimer((prev) => prev - 1);
    }, 1000);
    return () => clearTimeout(timerId);
  }, [activeExam, examTimer, examResult]);

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (activeExam && !examResult) {
      window.history.pushState(null, "", window.location.href);
      
      const triggerViolation = () => {
        setIsViolationSirening(true);
        startSiren();
      };

      const handlePopState = () => {
        // Kunci secara paksa navigasi history agar tidak benar-benar kembali ke halaman sebelumnya
        window.history.pushState(null, "", window.location.href);
        // Tampilkan kotak dialog peringatan keras terlebih dahulu
        setPendingNavAction({ type: "popstate_attempt" });
        setShowExitWarningModal(true);
      };
      
      const handleVisibilityChange = () => {
        // Terjadi jika menekan menu tengah/home, ganti tab browser, mengunci telpon, dll
        if (document.hidden || document.visibilityState === "hidden") {
          triggerViolation();
        }
      };

      const handleFullscreenChange = () => {
        const isFS = !!(
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement
        );
        setIsFullscreenActive(isFS);
        if (!isFS) {
          triggerViolation();
        }
      };

      const handleBlur = () => {
        // According to user request, we make the system more relaxed for minor interruptions
        // though we still track significant visibility changes via visibilitychange
        return;
      };

      const handlePageHide = () => {
        // No violation on page hide/refresh as per user request
        return;
      };

      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        // According to user request, refresh should not affect the exam (no violation penalty)
        // Persistence is handled by localStorage syncing in useEffect
        const msg = "Ujian sedang aktif! Anda dapat memuat ulang halaman jika diperlukan, progres Anda akan tersimpan.";
        e.returnValue = msg;
        return msg;
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (
          e.key === "PrintScreen" || 
          e.code === "PrintScreen" ||
          (e.ctrlKey && (e.key === "p" || e.key === "s" || e.key === "c")) ||
          (e.metaKey && e.shiftKey && (e.key === "3" || e.key === "4" || e.key === "5" || e.key === "s" || e.key === "S" || e.code?.includes("Digit")))
        ) {
          e.preventDefault();
          triggerViolation();
        }
      };

      // Blokir tombol navigasi kembali / hardware back gesture
      window.addEventListener("popstate", handlePopState);
      
      // Blokir minimizing / perpindahan tab browser / tombol Home
      document.addEventListener("visibilitychange", handleVisibilityChange);
      
      // Deteksi keluar layar penuh
      document.addEventListener("fullscreenchange", handleFullscreenChange);
      document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.addEventListener("mozfullscreenchange", handleFullscreenChange);
      document.addEventListener("MSFullscreenChange", handleFullscreenChange);
      
      // Blokir aktivitas overview screen (Recent Apps), split screen, panel notifikasi ditarik ke bawah
      window.addEventListener("blur", handleBlur);
      
      // Deteksi keluar instan
      window.addEventListener("pagehide", handlePageHide);
      
      // Cegah reload refresh manual atau menutup halaman browser
      window.addEventListener("beforeunload", handleBeforeUnload);

      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("contextmenu", (e) => e.preventDefault());
      window.addEventListener("copy", (e) => { e.preventDefault(); triggerViolation(); });
      
      return () => {
        window.removeEventListener("popstate", handlePopState);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        document.removeEventListener("fullscreenchange", handleFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
        document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
        document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("pagehide", handlePageHide);
        window.removeEventListener("beforeunload", handleBeforeUnload);
        window.removeEventListener("keydown", handleKeyDown);
        stopSiren();
      };
    }
  }, [activeExam, examResult]);

  const fetchAnnouncements = async () => {
    const cacheKey = `firas_cache_announcements_${student?.nisn || 'guest'}`;
    const cached = getLocalCache<any[]>(cacheKey, 4 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      const snapshot = await getDocs(query(collection(db, "announcements")));
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      setIsOffline(false);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error announcements:`, e.message);
      dispatchIfQuotaError(e);
      setIsOffline(true);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || [];
    }
  };

  const { data: announcementsList = EMPTY_ARRAY, error: errAnnouncements, mutate: mutateAnnouncements } = useSWR(
    student ? 'announcements' : null,
    fetchAnnouncements,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const fetchAssignments = async () => {
    const cacheKey = `firas_cache_assignments_${student?.nisn || 'guest'}`;
    const cached = getLocalCache<any[]>(cacheKey, 4 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      const snapshot = await getDocs(query(collection(db, "assignments")));
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      setIsOffline(false);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error assignments:`, e.message);
      dispatchIfQuotaError(e);
      setIsOffline(true);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || [];
    }
  };

  const { data: rawAssignments = EMPTY_ARRAY, error: errAssignments, mutate: mutateAssignments } = useSWR(
    student ? 'assignments' : null,
    fetchAssignments,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const assignmentsList = useMemo(() => {
    if (!student) return EMPTY_ARRAY;
    return rawAssignments.filter((assign: any) => {
      if (assign.targets && assign.targets.length > 0) {
        return assign.targets.some((t: any) => (t.kelas || "").toString().trim().toLowerCase() === (student.kelas || "").toString().trim().toLowerCase());
      }
      const aKelas = (assign.kelas || "").toString().trim().toLowerCase(); const sKelas = (student.kelas || "").toString().trim().toLowerCase(); return aKelas === sKelas || !aKelas || aKelas === "semua kelas" || aKelas === "semua_kelas";
    });
  }, [rawAssignments, student]);

  const fetchSubmissions = async () => {
    if (!student?.nisn) return [];
    const cacheKey = `firas_cache_submissions_${student.nisn}`;
    const cached = getLocalCache<any[]>(cacheKey, 1 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      const snapshot = await getDocs(query(collection(db, "submissions"), where("nisn", "==", student.nisn)));
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      setIsOffline(false);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error submissions:`, e.message);
      dispatchIfQuotaError(e);
      setIsOffline(true);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || [];
    }
  };

  const { data: submissionsList = EMPTY_ARRAY, error: errSubmissions, mutate: mutateSubmissions } = useSWR(
    student?.nisn ? ['submissions', student.nisn] : null,
    fetchSubmissions,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const fetchFinalGrades = async () => {
    if (!student?.nisn) return [];
    const cacheKey = `firas_cache_final_grades_${student.nisn}`;
    const cached = getLocalCache<any[]>(cacheKey, 2 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      const snapshot = await getDocs(query(collection(db, "final_grades"), where("nisn", "==", student.nisn)));
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      setIsOffline(false);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error final grades:`, e.message);
      dispatchIfQuotaError(e);
      setIsOffline(true);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || [];
    }
  };

  const { data: finalGradesList = EMPTY_ARRAY, error: errFinalGrades, mutate: mutateFinalGrades } = useSWR(
    student?.nisn ? ['final_grades', student.nisn] : null,
    fetchFinalGrades,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const fetchAllStudents = async () => {
    if (!student?.kelas) return [];
    const cacheKey = `firas_cache_all_students_${student.kelas}`;
    const cached = getLocalCache<any[]>(cacheKey, 12 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      // Query only classmates to save over 90% in Firestore read counts and ensure privacy
      const q = query(collection(db, "studentsByNisn"), where("kelas", "==", student.kelas));
      const snapshot = await getDocs(q);
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error all students:`, e.message);
      dispatchIfQuotaError(e);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || [];
    }
  };

  const { data: allStudentsList = EMPTY_ARRAY, mutate: mutateAllStudents } = useSWR(
    student?.kelas ? ['all_students_list', student.kelas] : null,
    fetchAllStudents,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const fetchAllFinalGrades = async () => {
    if (!student?.kelas) return [];
    const cacheKey = `firas_cache_all_final_grades_${student.kelas}`;
    const cached = getLocalCache<any[]>(cacheKey, 2 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      // Query only grades within student's class (kelas) to reduce reads dramatically
      const q = query(collection(db, "final_grades"), where("kelas", "==", student.kelas));
      const snapshot = await getDocs(q);
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error all final grades:`, e.message);
      dispatchIfQuotaError(e);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || [];
    }
  };

  const { data: allFinalGrades = EMPTY_ARRAY, mutate: mutateAllFinalGrades } = useSWR(
    student?.kelas ? ['all_final_grades', student.kelas] : null,
    fetchAllFinalGrades,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const fetchExams = async () => {
    const cacheKey = `firas_cache_exams_${student?.nisn || 'guest'}`;
    const cached = getLocalCache<any[]>(cacheKey, 4 * 60 * 60 * 1000);
    if (cached) return cached;

    try {
      const snapshot = await getDocs(query(collection(db, "exams")));
      trackUsage(snapshot.size, 0);
      const data = snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as any) }));
      setLocalCache(cacheKey, data);
      setIsOffline(false);
      return data;
    } catch (e: any) {
      console.warn(`SWR fetch error exams:`, e.message);
      dispatchIfQuotaError(e);
      setIsOffline(true);
      const stale = getLocalCache<any[]>(cacheKey, 24 * 60 * 60 * 1000);
      return stale || MOCK_EXAMS;
    }
  };

  const { data: rawExams = EMPTY_ARRAY, error: errExams, mutate: mutateExams } = useSWR(
    student ? 'exams' : null,
    fetchExams,
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const [isRefreshingData, setIsRefreshingData] = useState(false);

  const handleManualRefresh = async () => {
    if (isRefreshingData) return;
    setIsRefreshingData(true);
    try {
      if (student?.nisn) {
        clearStudentCaches(student.nisn, student?.kelas);
      }
      await Promise.allSettled([
        mutateAnnouncements(),
        mutateAssignments(),
        mutateSubmissions(),
        mutateFinalGrades(),
        mutateAllStudents(),
        mutateAllFinalGrades(),
        mutateExams(),
      ]);
      setSyncToastMessage("Data berhasil diperbarui!");
      setTimeout(() => setSyncToastMessage(""), 3000);
    } catch (e) {
      console.warn("Manual refresh error:", e);
    } finally {
      setTimeout(() => setIsRefreshingData(false), 500);
    }
  };

  const examsList = useMemo(() => {
    if (!student) return EMPTY_ARRAY;
    const studentKelas = (student?.kelas || "").toString().trim().toLowerCase();
    return rawExams.filter((exam: any) => { const ref = (exam.kelasRef || "").toString().trim().toLowerCase(); return !ref || ref === "semua_kelas" || ref === "semua kelas" || ref === studentKelas; });
  }, [rawExams, student]);

  const combinedGrades = useMemo(() => {
    if (!student) return [];
    
    const list: any[] = [];
    
    assignmentsList.forEach((assign: any) => {
      const submission = submissionsList.find((s: any) => s.assignmentId === assign.id);
      if (submission && submission.nilai !== undefined && submission.nilai !== null) {
        list.push({
          id: assign.id,
          title: assign.title || assign.materi,
          bab: assign.bab || "Informatika",
          subtitle: assign.description || "Tugas Mandiri/Kelompok",
          type: "Tugas",
          nilai: Number(submission.nilai),
          tanggal: submission.submittedAt ? new Date(submission.submittedAt).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric"
          }) : "-",
          rawDate: submission.submittedAt || ""
        });
      }
    });

    examsList.forEach((exam: any) => {
      const fGrade = finalGradesList.find((f: any) => f.assignmentId === exam.id && f.nisn === student.nisn);
      if (fGrade && fGrade.nilai !== undefined && fGrade.nilai !== null) {
        list.push({
          id: exam.id,
          title: exam.title,
          bab: exam.bab || fGrade.bab || "Informatika",
          subtitle: "Ujian / Evaluasi",
          type: "Ujian",
          nilai: Number(fGrade.nilai),
          tanggal: fGrade.gradedAt ? new Date(fGrade.gradedAt).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric"
          }) : "-",
          rawDate: fGrade.gradedAt || ""
        });
      }
    });

    return list.sort((a, b) => {
      if (!a.rawDate) return 1;
      if (!b.rawDate) return -1;
      return new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime();
    });
  }, [assignmentsList, submissionsList, examsList, finalGradesList, student]);



  const nilaiTertinggi = useMemo(() => {
    if (combinedGrades.length === 0) return 0;
    return Math.max(...combinedGrades.map(g => g.nilai));
  }, [combinedGrades]);

  const nilaiTerendah = useMemo(() => {
    if (combinedGrades.length === 0) return 0;
    return Math.min(...combinedGrades.map(g => g.nilai));
  }, [combinedGrades]);

  const highestGradeTitle = useMemo(() => {
    if (combinedGrades.length === 0) return "Belum ada data";
    const highest = combinedGrades.reduce((prev, current) => (prev.nilai > current.nilai) ? prev : current);
    return highest.title;
  }, [combinedGrades]);

  const lowestGradeTitle = useMemo(() => {
    if (combinedGrades.length === 0) return "Belum ada data";
    const lowest = combinedGrades.reduce((prev, current) => (prev.nilai < current.nilai) ? prev : current);
    return lowest.title;
  }, [combinedGrades]);

  // Helpers for per-class assignment targets
  const getAssignmentTargetForStudent = (a: any, studentKelas?: string) => {
    if (!studentKelas) return null;
    if (a.targets && Array.isArray(a.targets) && a.targets.length > 0) {
      const target = a.targets.find((t: any) => 
        (t.kelas || "").toString().trim().toLowerCase() === (studentKelas || "").toString().trim().toLowerCase()
      );
      if (target) return target;
    }
    return null;
  };

  const getAssignmentPublishedAtForStudent = (a: any, studentKelas?: string) => {
    const target = getAssignmentTargetForStudent(a, studentKelas);
    if (target && target.publishedAt) return new Date(target.publishedAt);
    return new Date(a.publishedAt || a.createdAt || Date.now());
  };

  const getAssignmentDeadlineForStudent = (a: any, studentKelas?: string) => {
    const target = getAssignmentTargetForStudent(a, studentKelas);
    if (target && target.deadline) return target.deadline;
    return a.deadline;
  };

  // Calculate uncompleted tasks
  const uncompletedTasksCount = useMemo(() => {
    return assignmentsList.filter(a => {
      const pubDate = getAssignmentPublishedAtForStudent(a, student?.kelas);
      if (pubDate > new Date()) return false;
      const isSubmitted = submissionsList.some((s) => s.assignmentId === a.id);
      return !isSubmitted;
    }).length;
  }, [assignmentsList, submissionsList, student]);

  const rejectedSubmissionsCount = useMemo(() => {
    return submissionsList.filter(s => s.status === "ditolak").length;
  }, [submissionsList]);

  const rataRataNilaiUjian = useMemo(() => {
    const examGrades = finalGradesList.filter(
      (f) =>
        f.nisn === student?.nisn &&
        f.assignmentId && 
        (f.assignmentId.startsWith("EXM-") ||
          f.assignmentId.startsWith("ujian-") ||
          examsList.some((e) => e.id === f.assignmentId) ||
          MOCK_EXAMS.some((e) => e.id === f.assignmentId))
    );
    if (examGrades.length === 0) return 0;
    const total = examGrades.reduce((acc, curr) => acc + Number(curr.nilai || 0), 0);
    return Math.round(total / examGrades.length);
  }, [finalGradesList, student, examsList]);

  const rataRataNilaiTugas = useMemo(() => {
    const submitted = submissionsList.filter(s => s.nilai !== undefined && s.nilai !== null);
    if (submitted.length === 0) return 0;
    const total = submitted.reduce((acc, curr) => acc + Number(curr.nilai), 0);
    return Math.round(total / submitted.length);
  }, [submissionsList]);

  const menungguTugasDinilaiCount = useMemo(() => {
    return submissionsList.filter(s => s.status === "menunggu penilaian guru").length;
  }, [submissionsList]);

  const [readAnnIds, setReadAnnIds] = useState<string[]>([]);

  const attendanceSummary = useMemo(() => {
    if (!student || absensiList.length === 0) return null;
    const stats = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, Dispen: 0 };
    let totalMeetings = 0;

    absensiList.forEach(a => {
        const studentStatus = a.data[student.nisn];
        if (studentStatus) {
            stats[studentStatus as keyof typeof stats]++;
            totalMeetings++;
        }
    });

    const attended = stats.Hadir + stats.Dispen;
    const percentageNum = totalMeetings > 0 ? Math.round((attended / totalMeetings) * 100) : 0;
    const percentage = percentageNum.toString();

    // New Rubric Logic
    let rubricStatus: "Sangat Rajin" | "Rajin" | "Cukup Rajin" | "Kurang Rajin" = "Rajin";
    
    if (percentageNum >= 95 && stats.Alpa === 0 && (stats.Sakit + stats.Izin) <= 2) {
      rubricStatus = "Sangat Rajin";
    } else if (percentageNum >= 90 && stats.Alpa < 1) {
      rubricStatus = "Rajin";
    } else if (percentageNum >= 80 && stats.Alpa < 3) {
      rubricStatus = "Cukup Rajin";
    } else {
      rubricStatus = "Kurang Rajin";
    }

    // Logic for "Jarang Masuk" warning
    let warningLevel: "none" | "warning" | "critical" = "none";
    let remark = "Kehadiran Sangat Baik";
    
    if (stats.Alpa >= 3 || percentageNum < 80) {
      warningLevel = "critical";
      remark = "Peringatan: Kamu Sangat Jarang Masuk. Segera hubungi wali kelas.";
    } else if (stats.Alpa >= 1 || percentageNum < 90) {
      warningLevel = "warning";
      remark = "Perhatian: Kehadiranmu mulai menurun. Tingkatkan lagi ya!";
    }

    return { ...stats, totalMeetings, percentage, warningLevel, remark, rubricStatus };
  }, [absensiList, student]);

  const rataRataSemester = useMemo(() => {
    if (!student || !rubric) return 0;

    // 1. Nilai Kehadiran
    let stuHadirCount = 0;
    let stuTotalMeetings = 0;
    const myClass = String(student.kelas || "").trim().toLowerCase();
    absensiList.forEach((a: any) => {
      if (String(a.kelasRef || "").trim().toLowerCase() === myClass) {
        stuTotalMeetings++;
        if (a.data && a.data[student.nisn]) {
          const sStatus = String(a.data[student.nisn]).toLowerCase();
          if (sStatus === "hadir" || sStatus === "dispen") {
            stuHadirCount++;
          }
        }
      }
    });
    const nilaiKehadiran = stuTotalMeetings > 0 ? (stuHadirCount / stuTotalMeetings) * 100 : 0;

    // 2. Nilai Tugas & Harian
    const tugasItems = allFinalGrades.filter((g: any) => {
      if (g.nisn !== student.nisn) return false;
      if (g.type === "Tugas") return true;
      const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
      const category = exam?.category || "";
      return category !== "Penilaian Tengah Semester" && category !== "Penilaian Sumatif Akhir Semester";
    });
    const avgTugas = tugasItems.length > 0 
      ? tugasItems.reduce((sum: number, item: any) => sum + (Number(item.nilai) || 0), 0) / tugasItems.length 
      : 0;

    // 3. Nilai UTS
    const utsItem = allFinalGrades.find((g: any) => {
      if (g.nisn !== student.nisn) return false;
      const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
      return exam?.category === "Penilaian Tengah Semester";
    });
    const nilaiUts = utsItem ? (Number(utsItem.nilai) || 0) : 0;

    // 4. Nilai UAS
    const uasItem = allFinalGrades.find((g: any) => {
      if (g.nisn !== student.nisn) return false;
      const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
      return exam?.category === "Penilaian Sumatif Akhir Semester";
    });
    const nilaiUas = uasItem ? (Number(uasItem.nilai) || 0) : 0;

    // Final Calculation based on teacher's rubric
    const finalScore = (
      (nilaiKehadiran * (rubric.kehadiran / 100)) +
      (avgTugas * (rubric.tugas / 100)) +
      (nilaiUts * (rubric.uts / 100)) +
      (nilaiUas * (rubric.uas / 100))
    );
    
    return Math.round(finalScore);
  }, [allFinalGrades, absensiList, examsList, student, rubric]);

  const rankings = useMemo(() => {
    if (!student || !rubric || allStudentsList.length === 0) {
      return { rank: "-", total: "-" };
    }
    
    // Normalize class names for more robust matching
    const myClass = String(student.kelas || "").trim().toLowerCase();
    const studentsInClass = allStudentsList.filter((s: any) => 
      String(s.kelas || "").trim().toLowerCase() === myClass
    );

    if (studentsInClass.length === 0) return { rank: 1, total: 1 };
    
    const studentPerformance = studentsInClass.map((stu: any) => {
      // 1. Nilai Kehadiran
      let stuHadirCount = 0;
      let stuTotalMeetings = 0;
      absensiList.forEach((a: any) => {
        if (String(a.kelasRef || "").trim().toLowerCase() === myClass) {
          stuTotalMeetings++;
          if (a.data && a.data[stu.nisn]) {
            const sStatus = String(a.data[stu.nisn]).toLowerCase();
            if (sStatus === "hadir" || sStatus === "dispen") {
              stuHadirCount++;
            }
          }
        }
      });
      const nilaiKehadiran = stuTotalMeetings > 0 ? (stuHadirCount / stuTotalMeetings) * 100 : 0;

      // 2. Nilai Tugas & Harian
      const stuAllGrades = allFinalGrades.filter((g: any) => g.nisn === stu.nisn);
      const tugasItems = stuAllGrades.filter((g: any) => {
        if (g.type === "Tugas") return true;
        const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
        const category = exam?.category || "";
        return category !== "Penilaian Tengah Semester" && category !== "Penilaian Sumatif Akhir Semester";
      });
      const avgTugas = tugasItems.length > 0 
        ? tugasItems.reduce((sum: number, item: any) => sum + (Number(item.nilai) || 0), 0) / tugasItems.length 
        : 0;

      // 3. Nilai UTS
      const utsItem = stuAllGrades.find((g: any) => {
        const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
        return exam?.category === "Penilaian Tengah Semester";
      });
      const nilaiUts = utsItem ? (Number(utsItem.nilai) || 0) : 0;

      // 4. Nilai UAS
      const uasItem = stuAllGrades.find((g: any) => {
        const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
        return exam?.category === "Penilaian Sumatif Akhir Semester";
      });
      const nilaiUas = uasItem ? (Number(uasItem.nilai) || 0) : 0;

      // Final Calculation based on teacher's rubric
      const finalScore = (
        (nilaiKehadiran * (rubric.kehadiran / 100)) +
        (avgTugas * (rubric.tugas / 100)) +
        (nilaiUts * (rubric.uts / 100)) +
        (nilaiUas * (rubric.uas / 100))
      );

      return {
        nisn: stu.nisn,
        finalScore: finalScore
      };
    });

    studentPerformance.sort((a, b) => b.finalScore - a.finalScore);

    const myIndex = studentPerformance.findIndex((item) => item.nisn === student.nisn);
    const rank = myIndex !== -1 ? myIndex + 1 : 1;
    const total = studentsInClass.length;

    return { rank, total };
  }, [allStudentsList, allFinalGrades, absensiList, examsList, student, rubric]);

  const predikatAkhir = useMemo(() => {
    const avg = rataRataSemester;
    if (avg === 0) return "-";
    if (avg >= 92) return "A";
    if (avg >= 84) return "B";
    if (avg >= 75) return "C";
    return "D";
  }, [rataRataSemester]);

  const predikatColor = useMemo(() => {
    const pred = predikatAkhir;
    if (pred === "A" || pred === "B") return "text-emerald-600";
    if (pred === "C") return "text-amber-600";
    if (pred === "D") return "text-rose-600";
    return "text-slate-400";
  }, [predikatAkhir]);

  const integrityStatus = useMemo(() => {
    if (examViolationCount === 0) return { text: "Sangat Berintegritas", color: "text-emerald-500", bg: "bg-emerald-50", border: "border-emerald-100" };
    if (examViolationCount === 1) return { text: "Berintegritas", color: "text-blue-500", bg: "bg-blue-50", border: "border-blue-100" };
    if (examViolationCount === 2) return { text: "Cukup Berintegritas", color: "text-amber-500", bg: "bg-amber-50", border: "border-amber-100" };
    if (examViolationCount < 5) return { text: "Kurang Berintegritas", color: "text-orange-500", bg: "bg-orange-50", border: "border-orange-100" };
    return { text: "Sangat Kurang Berintegritas", color: "text-rose-500", bg: "bg-rose-50", border: "border-rose-100" };
  }, [examViolationCount]);

  const studentAttendanceData = useMemo(() => {
    if (!student || absensiList.length === 0) return [];
    return absensiList
      .filter(a => a.data && a.data[student.nisn])
      .map(a => ({
        id: a.id,
        date: a.date,
        subject: a.subject,
        status: a.data[student.nisn],
        keterangan: a.keterangan?.[student.nisn] || "-",
        teacher: a.teacherName || "Guru Mata Pelajaran"
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [absensiList, student]);

  const todayAttendance = useMemo(() => {
    if (studentAttendanceData.length === 0) return null;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const latest = studentAttendanceData[0];
    
    if (latest.date === today) {
      if (latest.status.toLowerCase() === "hadir" || latest.status.toLowerCase() === "sakit" || latest.status.toLowerCase() === "izin" || latest.status.toLowerCase() === "alpa" || latest.status.toLowerCase() === "dispen") {
        const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
        const monthNames = [
          "Januari", "Februari", "Maret", "April", "Mei", "Juni",
          "Juli", "Agustus", "September", "Oktober", "November", "Desember"
        ];
        
        let formattedDate = latest.date;
        try {
          const d = new Date(latest.date);
          const dayName = dayNames[d.getDay()];
          const dateNum = d.getDate();
          const monthName = monthNames[d.getMonth()];
          const year = d.getFullYear();
          formattedDate = `${dayName}, ${dateNum} ${monthName} ${year}`;
        } catch (e) {
          console.warn(e);
        }

        if (latest.status.toLowerCase() === "hadir") {
          return { 
            type: "hadir", 
            date: latest.date,
            title: "Status Kehadiran: Hadir",
            text: `Anda sekarang hadir di pembelajaran informatika pada hari ${formattedDate}. Terus tingkatkan kehadiranmu!` 
          };
        } else if (latest.status.toLowerCase() === "sakit") {
          return { 
            type: "sakit", 
            date: latest.date,
            title: "Status Kehadiran: Sakit",
            text: `Kamu terdeteksi sakit pada hari ${formattedDate}. Semoga lekas sembuh, kami mendoakan kesehatanmu.` 
          };
        } else if (latest.status.toLowerCase() === "izin") {
          return { 
            type: "izin", 
            date: latest.date,
            title: "Status Kehadiran: Izin",
            text: `Kamu izin hari ini (${formattedDate}). Semoga acaranya lancar.` 
          };
        } else if (latest.status.toLowerCase() === "alpa") {
          return {
            type: "alpa",
            date: latest.date,
            title: "Status Kehadiran: Alpa",
            text: `Kamu terdeteksi Alpa (tanpa keterangan) pada hari ${formattedDate}. Silakan segera hubungi wali kelas.`
          };
        } else if (latest.status.toLowerCase() === "dispen") {
          return {
            type: "dispen",
            date: latest.date,
            title: "Status Kehadiran: Dispensasi",
            text: `Kamu mendapatkan Dispensasi pada hari ${formattedDate}. Semoga bisa menyeimbangkan antara pembelajaran dan tugas sekolah.`
          };
        }
      }
    }
    return null;
  }, [studentAttendanceData]);

  const attendanceChartData = useMemo(() => {
    if (!attendanceSummary) return [];
    return [
      { name: "Hadir", value: attendanceSummary.Hadir, color: "#10b981" },
      { name: "Sakit", value: attendanceSummary.Sakit, color: "#3b82f6" },
      { name: "Izin", value: attendanceSummary.Izin, color: "#f59e0b" },
      { name: "Alpa", value: attendanceSummary.Alpa, color: "#ef4444" },
      { name: "Dispen", value: attendanceSummary.Dispen, color: "#8b5cf6" },
    ].filter(d => d.value > 0);
  }, [attendanceSummary]);

  const dashboardAnnouncements = useMemo(() => {
    if (!student) return EMPTY_ARRAY;
    return announcementsList.filter(ann => 
      (ann.kelasRef === student?.kelas || ann.kelasRef === "SEMUA_KELAS") &&
      !readAnnIds.includes(ann.id)
    );
  }, [announcementsList, student, readAnnIds]);

  const dashboardTasks = useMemo(() => {
    if (!student) return { today: [], comingSoon: [] };
    const now = new Date();
    
    const today = assignmentsList.filter((a) => {
      const pubDate = getAssignmentPublishedAtForStudent(a, student.kelas);
      const isToday =
        pubDate.getDate() === now.getDate() &&
        pubDate.getMonth() === now.getMonth() &&
        pubDate.getFullYear() === now.getFullYear();
      const isMengumpul = submissionsList.some((s) => s.assignmentId === a.id);
      return isToday && !isMengumpul && pubDate <= now;
    });

    const comingSoon = assignmentsList.filter((a) => {
      const pubDate = getAssignmentPublishedAtForStudent(a, student.kelas);
      return pubDate > now;
    });

    return { today, comingSoon };
  }, [assignmentsList, submissionsList, student]);

  const activeAssignments = useMemo(() => {
    if (!student) return EMPTY_ARRAY;
    const now = new Date();
    return assignmentsList
      .filter((a) => getAssignmentPublishedAtForStudent(a, student.kelas) <= now)
      .sort((a, b) => {
        const dateA = getAssignmentPublishedAtForStudent(a, student.kelas).getTime();
        const dateB = getAssignmentPublishedAtForStudent(b, student.kelas).getTime();
        return dateB - dateA;
      })
      .filter((a) => {
        const isDinilaiEntry = finalGradesList.find(
          (f) => f.assignmentId === a.id && f.nisn === student.nisn
        );
        return !isDinilaiEntry?.hiddenByStudents?.includes(student.nisn);
      });
  }, [assignmentsList, finalGradesList, student]);

  const unifiedAcademicItems = useMemo(() => {
    if (!student) return EMPTY_ARRAY;
    
    const examGradeEntries = finalGradesList.filter(
      (f) =>
        f.nisn === student.nisn &&
        f.assignmentId && 
        (f.assignmentId.startsWith("EXM-") ||
          f.assignmentId.startsWith("ujian-") ||
          examsList.some((e) => e.id === f.assignmentId) ||
          MOCK_EXAMS.some((e) => e.id === f.assignmentId))
    );

    return [
      ...submissionsList
        .filter((sub) => {
          const isDinilaiEntry = finalGradesList.find(
            (f) => f.assignmentId === sub.assignmentId && f.nisn === student.nisn
          );
          return !isDinilaiEntry?.hiddenByStudents?.includes(student.nisn);
        })
        .map((sub) => {
          const assignment = assignmentsList.find((a) => a.id === sub.assignmentId);
          return {
            id: sub.id,
            title: assignment ? assignment.materi : "Data Terhapus",
            bab: assignment ? assignment.bab : "-",
            submittedAt: sub.submittedAt,
            type: "Tugas Mandiri",
            status: sub.nilai ? "Sudah Dinilai" : "Menunggu Antrian",
            nilai: sub.nilai || "",
          };
        }),
      ...examGradeEntries.map((f) => {
        const exam = examsList.find((e) => e.id === f.assignmentId) || MOCK_EXAMS.find((e) => e.id === f.assignmentId);
        return {
          id: f.id,
          title: exam ? exam.title : (f.examTitle || `Ujian Online`),
          bab: f.bab || (exam ? (exam.bab || (exam.title?.includes(" - ") ? exam.title.split(" - ")[1] : "Informatika")) : "Informatika"),
          submittedAt: f.gradedAt || new Date().toISOString(),
          type: "Ujian CBT (Online)",
          status: "Selesai",
          nilai: f.nilai,
        };
      }),
    ].sort((a, b) => {
      const dateA = new Date(a.submittedAt).getTime();
      const dateB = new Date(b.submittedAt).getTime();
      return dateB - dateA;
    });
  }, [submissionsList, finalGradesList, assignmentsList, examsList, student]);

  const reportCardGrade = useMemo(() => {
    if (!student || !rubric) return null;

    // 1. Nilai Kehadiran (Percentage of meetings attended/dispen)
    let studentHadirCount = 0;
    let studentTotalMeetings = 0;

    // Filter absensi by student's class and count meetings
    absensiList.forEach(a => {
      if (a.kelasRef === student.kelas) {
        studentTotalMeetings++;
        if (a.data && a.data[student.nisn]) {
          const sStatus = String(a.data[student.nisn]).toLowerCase();
          if (sStatus === "hadir" || sStatus === "dispen") {
            studentHadirCount++;
          }
        }
      }
    });

    const nilaiKehadiran = studentTotalMeetings > 0 ? (studentHadirCount / studentTotalMeetings) * 100 : 0;

    // 2. Nilai Tugas & Harian (Include Tasks and Exams that are NOT UTS/UAS)
    const tugasVals: number[] = [];
    let nilaiUts = 0;
    let nilaiUas = 0;

    const studentAssignments = assignmentsList.filter(a => !a.kelas || a.kelas === student.kelas || a.kelas === "Semua Kelas");
    studentAssignments.forEach(a => {
      const sub = submissionsList.find(s => s.assignmentId === a.id && s.nisn === student.nisn);
      const fGrade = finalGradesList.find(f => f.assignmentId === a.id && f.nisn === student.nisn);
      const val = sub?.nilai !== undefined && sub?.nilai !== null && sub?.nilai !== "" ? sub.nilai : fGrade?.nilai;
      if (val !== undefined && val !== null && val !== "") {
        tugasVals.push(Number(val));
      } else {
        tugasVals.push(0);
      }
    });

    const studentExams = examsList.filter(e => !e.kelas || e.kelas === student.kelas || e.kelas === "Semua Kelas");
    studentExams.forEach(e => {
      const fGrade = finalGradesList.find(f => (f.alignmentId === e.id || f.assignmentId === e.id) && f.nisn === student.nisn);
      if (fGrade?.nilai !== undefined && fGrade?.nilai !== null && fGrade?.nilai !== "") {
        const n = Number(fGrade.nilai);
        if (e.category === "Penilaian Tengah Semester") nilaiUts = n;
        else if (e.category === "Penilaian Sumatif Akhir Semester") nilaiUas = n;
        else tugasVals.push(n);
      } else {
        if (e.category === "Penilaian Tengah Semester") nilaiUts = 0;
        else if (e.category === "Penilaian Sumatif Akhir Semester") nilaiUas = 0;
        else tugasVals.push(0);
      }
    });

    const avgTugas = tugasVals.length > 0 
      ? tugasVals.reduce((sum, item) => sum + item, 0) / tugasVals.length 
      : 0;

    // Final Calculation based on teacher's rubric
    const finalScore = (
      (nilaiKehadiran * (rubric.kehadiran / 100)) +
      (avgTugas * (rubric.tugas / 100)) +
      (nilaiUts * (rubric.uts / 100)) +
      (nilaiUas * (rubric.uas / 100))
    );

    return {
      nilaiKehadiran: Math.round(nilaiKehadiran),
      avgTugas: Math.round(avgTugas),
      nilaiUts: Math.round(nilaiUts),
      nilaiUas: Math.round(nilaiUas),
      finalScore: Math.round(finalScore),
      totalMeetings: studentTotalMeetings,
      hadirCount: studentHadirCount
    };
  }, [student, rubric, absensiList, combinedGrades, examsList]);

  const [taskSearch, setTaskSearch] = useState("");
  const [activeProfileTab, setActiveProfileTab] = useState("Data Pribadi");
  const [taskStatusFilter, setTaskStatusFilter] = useState<"semua" | "selesai" | "tertunda" | "terlambat">("semua");

  const gradeTrendData = useMemo(() => {
    if (!student) return [];
    
    const gradedItems = unifiedAcademicItems
      .filter((item) => item.nilai !== undefined && item.nilai !== null && item.nilai !== "")
      .map((item) => ({
        title: item.title,
        type: item.type,
        score: Number(item.nilai),
        submittedAt: item.submittedAt,
      }))
      .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());

    let runningSum = 0;
    return gradedItems.map((item, index) => {
      runningSum += item.score;
      const runningAvg = Math.round((runningSum / (index + 1)) * 10) / 10;
      return {
        name: item.title,
        type: item.type,
        score: item.score,
        avg: runningAvg,
        dateStr: new Date(item.submittedAt).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        }),
      };
    });
  }, [unifiedAcademicItems, student]);

  const allAssignedTasksWithStatus = useMemo(() => {
    if (!student) return [];
    
    return assignmentsList.map((assignment) => {
      let deadlineStr = assignment.deadline;
      let publishedAtStr = assignment.publishedAt || assignment.createdAt;

      if (assignment.targets && assignment.targets.length > 0) {
        const target = assignment.targets.find((t: any) => 
          (t.kelas || "").toString().trim().toLowerCase() === (student.kelas || "").toString().trim().toLowerCase()
        );
        if (target) {
          if (target.deadline) deadlineStr = target.deadline;
          if (target.publishedAt) publishedAtStr = target.publishedAt;
        }
      }

      const sub = submissionsList.find((s) => s.assignmentId === assignment.id);
      const isCompleted = !!sub && sub.status !== "ditolak";

      let status: "selesai" | "tertunda" | "terlambat" = "tertunda";
      if (isCompleted) {
        status = "selesai";
      } else if (deadlineStr) {
        const hasDeadlinePassed = new Date() > new Date(deadlineStr);
        if (hasDeadlinePassed) {
          status = "terlambat";
        } else {
          status = "tertunda";
        }
      }

      return {
        id: assignment.id,
        title: assignment.materi,
        bab: assignment.bab || "-",
        description: assignment.description || "",
        deadline: deadlineStr,
        publishedAt: publishedAtStr,
        status,
        submission: sub,
        taskLink: assignment.taskLink,
        linkTugas: assignment.linkTugas,
        fileUrl: assignment.fileUrl,
        driveUrl: assignment.driveUrl,
      };
    }).sort((a, b) => {
      const aRejected = a.submission?.status === "ditolak";
      const bRejected = b.submission?.status === "ditolak";
      
      if (aRejected && !bRejected) return -1;
      if (!aRejected && bRejected) return 1;

      const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return dateB - dateA;
    });
  }, [assignmentsList, submissionsList, student]);

  const blendedTasks = useMemo(() => {
    return allAssignedTasksWithStatus.map(real => ({
      id: real.id,
      title: real.title || "Tugas Mandiri",
      materi: real.title || "Tugas Mandiri",
      bab: real.bab || "Informatika",
      description: real.description || "Silakan baca instruksi tugas dari Guru.",
      deadline: real.deadline || new Date().toISOString(),
      publishedAt: real.publishedAt || new Date().toISOString(),
      iconColor: "text-blue-600 bg-blue-50 border-blue-100",
      status: real.status,
      submission: real.submission,
      taskLink: real.taskLink,
      linkTugas: real.linkTugas,
      fileUrl: real.fileUrl,
      driveUrl: real.driveUrl,
    }));
  }, [allAssignedTasksWithStatus]);

  const rejectedTasks = useMemo(() => {
    return blendedTasks.filter((t) => t.submission?.status === "ditolak");
  }, [blendedTasks]);

  const filteredTasksBySubject = useMemo(() => {
    // Show all tasks assigned to the student's class.
    // The "bab" field is used by teachers to input specific chapters (e.g. "Bab 1", "Bab 2"),
    // so strictly matching "Informatika" against it hides the assignments.
    return blendedTasks;
  }, [blendedTasks]);

  const totalTasksCount = useMemo(() => filteredTasksBySubject.length, [filteredTasksBySubject]);
  const selesaiTasksCount = useMemo(() => filteredTasksBySubject.filter(t => t.status === "selesai").length, [filteredTasksBySubject]);
  const belumDikerjakanTasksCount = useMemo(() => filteredTasksBySubject.filter(t => t.status === "tertunda").length, [filteredTasksBySubject]);
  const terlambatTasksCount = useMemo(() => filteredTasksBySubject.filter(t => t.status === "terlambat").length, [filteredTasksBySubject]);

  const selesaiPercentage = useMemo(() => totalTasksCount > 0 ? Math.round((selesaiTasksCount / totalTasksCount) * 100) : 0, [totalTasksCount, selesaiTasksCount]);
  const belumDikerjakanPercentage = useMemo(() => totalTasksCount > 0 ? Math.round((belumDikerjakanTasksCount / totalTasksCount) * 100) : 0, [totalTasksCount, belumDikerjakanTasksCount]);
  const terlambatPercentage = useMemo(() => totalTasksCount > 0 ? Math.round((terlambatTasksCount / totalTasksCount) * 100) : 0, [totalTasksCount, terlambatTasksCount]);

  const [dismissedGradedAlerts, setDismissedGradedAlerts] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("dismissed_graded_alerts");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (student?.nisn) {
      try {
        const key = `dismissed_graded_alerts_${student.nisn}`;
        const stored = localStorage.getItem(key);
        setDismissedGradedAlerts(stored ? JSON.parse(stored) : []);
      } catch {
        setDismissedGradedAlerts([]);
      }
    }
  }, [student?.nisn]);

  const handleDismissGradedAlert = (alertId: string) => {
    if (!student?.nisn) return;
    const key = `dismissed_graded_alerts_${student.nisn}`;
    const updated = Array.from(new Set([...dismissedGradedAlerts, alertId]));
    setDismissedGradedAlerts(updated);
    try {
      localStorage.setItem(key, JSON.stringify(updated));
    } catch (e) {
      console.warn("Failed to save dismissed graded alert:", e);
    }
  };

  const gradedTaskAlerts = useMemo(() => {
    if (!student) return [];

    return assignmentsList
      .map((assignment) => {
        const sub = submissionsList.find(
          (s) => s.assignmentId === assignment.id && s.nisn === student.nisn
        );
        const fGrade = finalGradesList.find(
          (f) => f.assignmentId === assignment.id && f.nisn === student.nisn
        );

        const gradeVal =
          sub?.nilai !== undefined && sub?.nilai !== null && sub?.nilai !== ""
            ? sub.nilai
            : fGrade?.nilai !== undefined && fGrade?.nilai !== null && fGrade?.nilai !== ""
            ? fGrade.nilai
            : null;

        const isGraded =
          (sub && (sub.status === "sudah dinilai" || gradeVal !== null)) ||
          (fGrade && gradeVal !== null);

        if (!isGraded || gradeVal === null) return null;

        const alertId = `graded_alert_${assignment.id}_${gradeVal}`;

        if (dismissedGradedAlerts.includes(alertId)) return null;

        let pubDateObj = getAssignmentPublishedAtForStudent(assignment, student.kelas);
        const tanggalRilisStr = pubDateObj
          ? pubDateObj.toLocaleDateString("id-ID", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Tidak ditentukan";

        const submittedAtRaw = sub?.submittedAt || sub?.createdAt;
        const tanggalPenyerahanStr = submittedAtRaw
          ? new Date(submittedAtRaw).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Telah diserahkan";

        const numGrade = Number(gradeVal);
        let motivationalQuote =
          "Luar biasa! Hasil kerja kerasmu membuahkan hasil yang membanggakan. Tetap semangat dan tingkatkan terus prestasimu! 🌟🚀";
        if (numGrade >= 90) {
          motivationalQuote =
            "Sangat mengagumkan! Prestasi yang luar biasa tinggi. Pertahankan fokus dan semangat juangmu yang tinggi ini! 🏆✨";
        } else if (numGrade >= 75) {
          motivationalQuote =
            "Kerja bagus! Kamu sudah membuktikan kemampuan terbaikmu. Terus tingkatkan dan pelajari materi lebih dalam lagi! 💪📚";
        } else {
          motivationalQuote =
            "Tetap semangat dan pantang menyerah! Ini adalah pengalaman berharga untuk terus berkembang. Evaluasi kembali materi dan buat lompatan lebih baik di tugas berikutnya! 💡🌱";
        }

        return {
          alertId,
          assignment,
          materi: assignment.materi || "Tugas Mandiri",
          bab: assignment.bab || "-",
          score: gradeVal,
          tanggalRilis: tanggalRilisStr,
          tanggalPenyerahan: tanggalPenyerahanStr,
          motivationalQuote,
          catatanGuru: sub?.keterangan || sub?.feedback || fGrade?.catatan || "",
        };
      })
      .filter(Boolean) as Array<{
        alertId: string;
        assignment: any;
        materi: string;
        bab: string;
        score: any;
        tanggalRilis: string;
        tanggalPenyerahan: string;
        motivationalQuote: string;
        catatanGuru: string;
      }>;
  }, [assignmentsList, submissionsList, finalGradesList, student, dismissedGradedAlerts]);

  const displayedTasks = useMemo(() => {
    let tasks = filteredTasksBySubject;
    
    // Search filter
    if (searchQuery.trim() !== "") {
      const queryStr = searchQuery.toLowerCase();
      tasks = tasks.filter(t => 
        t.title.toLowerCase().includes(queryStr) || 
        t.description.toLowerCase().includes(queryStr)
      );
    }
    
    // Tab filter
    if (taskFilter !== "semua") {
      tasks = tasks.filter(t => t.status === taskFilter);
    }
    
    return tasks;
  }, [filteredTasksBySubject, taskFilter, searchQuery]);

  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (student?.nisn) {
      setReadAnnIds(JSON.parse(localStorage.getItem(`read_anns_${student.nisn}`) || "[]"));
    }
  }, [student?.nisn]);

  // Check for new announcements
  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (!student || announcementsList.length === 0 || viewedAnnouncement) return;
    
    // Find unread announcements for this student's class
    const unread = announcementsList.filter(ann => 
      (ann.kelasRef === student.kelas || ann.kelasRef === "SEMUA_KELAS") &&
      !readAnnIds.includes(ann.id)
    );

    if (unread.length > 0) {
      // Show the most recent unread announcement
      setViewedAnnouncement({
        ...unread[0],
        author: "Guru Mata Pelajaran"
      });
    }
  }, [announcementsList, student, viewedAnnouncement, readAnnIds]);

  const handleDismissAnnouncement = (id: string) => {
    const updated = [...readAnnIds, id];
    setReadAnnIds(updated);
    localStorage.setItem(`read_anns_${student.nisn}`, JSON.stringify(updated));
    setViewedAnnouncement(null);
  };

  // Effect to process notifications automatically (including new assignments and deadlines under 24 hours)
  useEffect(() => {
    initAuth(
      () => setNeedsDriveAuth(false),
      () => setNeedsDriveAuth(true)
    );
  }, []);

  useEffect(() => {
    if (!student) return;
    const now = new Date();
    const studentKelas = student.kelas || "";

    // 1. Rejected tasks (Tugas Ditolak)
    const rejectedNotifications = submissionsList
      .filter((s) => s.status === "ditolak")
      .map((s) => {
        const assignment = assignmentsList.find((a) => a.id === s.assignmentId);
        return {
          id: `rejected_${s.id}`,
          type: "rejected",
          title: "Tugas Perlu Diperbaiki",
          message: `${assignment?.materi || "Tugas"}: Perlu diperbaiki untuk meningkatkan nilai.`,
          timestamp: s.updatedAt || s.createdAt || new Date().toISOString(),
          assignmentId: s.assignmentId,
        };
      });

    // 2. Graded tasks (Tugas Sudah Dinilai)
    const gradedNotifications = finalGradesList
      .filter((g) => g.nisn === student.nisn)
      .map((g) => {
        const assignment = assignmentsList.find((a) => a.id === g.assignmentId);
        return {
          id: `graded_${g.id}_${g.nilai}`,
          type: "graded",
          title: "Tugas Sudah Dinilai",
          message: `${assignment?.materi || "Tugas"}: Selamat, Anda mendapatkan skor ${g.nilai}.`,
          timestamp: g.updatedAt || g.createdAt || new Date().toISOString(),
          assignmentId: g.assignmentId,
        };
      });

    // 3. New assignments published in the last 24 hours (and not submitted yet)
    const newAssignmentNotifications = assignmentsList
      .filter((a) => {
        // check if already submitted
        const isSubmitted = submissionsList.some((s) => s.assignmentId === a.id);
        if (isSubmitted) return false;

        const pubDate = getAssignmentPublishedAtForStudent(a, student?.kelas);
        const isPublished = pubDate <= now;
        const hoursSincePublish = (now.getTime() - pubDate.getTime()) / (1000 * 60 * 60);
        return isPublished && hoursSincePublish >= 0 && hoursSincePublish <= 24;
      })
      .map((a) => {
        const pubDate = getAssignmentPublishedAtForStudent(a, student?.kelas);
        return {
          id: `new_assign_${a.id}`,
          type: "new_assignment",
          title: "Tugas Baru Diterbitkan",
          message: `Tugas "${a.materi}" (${a.bab}) baru saja diterbikan. Silakan kerjakan sebelum tenggat waktu.`,
          timestamp: pubDate.toISOString(),
          assignmentId: a.id,
        };
      });

    // 4. Assignments with deadline in less than 24 hours (and not submitted yet)
    const nearDeadlineNotifications = assignmentsList
      .filter((a) => {
        // check if already submitted
        const isSubmitted = submissionsList.some((s) => s.assignmentId === a.id);
        if (isSubmitted) return false;

        // get relevant deadline
        let deadlineStr = a.deadline;
        if (a.targets && a.targets.length > 0) {
          const tgt = a.targets.find((t: any) => t.kelas === studentKelas);
          if (tgt) deadlineStr = tgt.deadline;
        }
        if (!deadlineStr) return false;

        const dlDate = new Date(deadlineStr);
        const msLeft = dlDate.getTime() - now.getTime();
        const hoursLeft = msLeft / (1000 * 60 * 60);
        // within 24 hours in the future
        return hoursLeft > 0 && hoursLeft <= 24;
      })
      .map((a) => {
        let deadlineStr = a.deadline;
        if (a.targets && a.targets.length > 0) {
          const tgt = a.targets.find((t: any) => t.kelas === studentKelas);
          if (tgt) deadlineStr = tgt.deadline;
        }
        const isValidDeadline = deadlineStr && !isNaN(new Date(deadlineStr).getTime());
        const timeStr = isValidDeadline
          ? new Date(deadlineStr).toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        const dateStr = isValidDeadline
          ? new Date(deadlineStr).toLocaleDateString("id-ID", {
              day: "numeric",
              month: "short",
            })
          : "";
        return {
          id: `near_deadline_${a.id}`,
          type: "near_deadline",
          title: "Tenggat Kurang 24 Jam",
          message: `Sisa waktu kurang dari 24 jam untuk tugas "${a.materi}"! (${dateStr} pukul ${timeStr}).`,
          timestamp: deadlineStr || new Date().toISOString(),
          assignmentId: a.id,
        };
      });

    // Combine all notification types and ensure unique IDs
    const combinedMap = new Map();
    [
      ...rejectedNotifications,
      ...gradedNotifications,
      ...newAssignmentNotifications,
      ...nearDeadlineNotifications,
    ].forEach((n, idx) => {
      const uniqueId = `${n.id || 'notif'}_${idx}`;
      combinedMap.set(uniqueId, { ...n, id: uniqueId });
    });
    const combined = Array.from(combinedMap.values());

    // Read dismissed keys from localStorage
    const dismissedKey = `dismissed_notifications_${student.nisn}`;
    let dismissed: string[] = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(dismissedKey) || "[]");
    } catch (e) {
      console.warn("Error reading dismissed notifications:", e);
    }

    // Determine unread notifications list
    const unread = combined.filter((n) => !dismissed.includes(n.id));

    setAllNotifications(combined);
    setShowNotifications(unread);
  }, [assignmentsList, submissionsList, finalGradesList, student]);

  // Handle marking a single notification as read and deleting it directly
  const handleDismissNotification = (id: string) => {
    if (!student) return;
    const dismissedKey = `dismissed_notifications_${student.nisn}`;
    let dismissed: string[] = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(dismissedKey) || "[]");
    } catch (e) { console.warn("Error parsing stored data:", e); }

    const newDismissed = Array.from(new Set([...dismissed, id]));
    localStorage.setItem(dismissedKey, JSON.stringify(newDismissed));

    setShowNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  // Handle marking all current notifications as read
  const handleDismissAllNotifications = () => {
    if (!student) return;
    const dismissedKey = `dismissed_notifications_${student.nisn}`;
    let dismissed: string[] = [];
    try {
      dismissed = JSON.parse(localStorage.getItem(dismissedKey) || "[]");
    } catch (e) { console.warn("Error parsing stored data:", e); }

    // Add currently visible notification IDs
    const newDismissed = Array.from(
      new Set([...dismissed, ...allNotifications.map((n) => n.id)]),
    );
    localStorage.setItem(dismissedKey, JSON.stringify(newDismissed));

    // Clear unread notifications list & close modal
    setShowNotifications([]);
    setIsNotificationsOpen(false);
  };

  const isDataError = errAnnouncements || errAssignments || errSubmissions || errFinalGrades || errExams;

  if (isLoadingInitialData) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-4 border-slate-200"></div>
            <div className="absolute inset-0 rounded-full border-4 border-[#85cc00] border-t-transparent animate-spin"></div>
          </div>
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest animate-pulse">Menyiapkan Dasbor...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-slate-800 mb-4">
            Siswa tidak ditemukan, silakan login kembali.
          </p>
            <button
              onClick={() => navigate("/", { replace: true })}
              className="rounded-2xl bg-[#85cc00] px-4 py-2 text-slate-950 font-bold hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-[#85cc00]/20"
            >
            Kembali ke Login
          </button>
        </div>

      </div>
    );
  }

  const menus = [
    { id: "dashboard", label: "Beranda", icon: Home },
    { id: "daftar-tugas", label: "Tugas Siswa", icon: FileText },
    { id: "nilai-siswa", label: "Nilai Siswa", icon: BarChart3 },
    { id: "kehadiran", label: "Kehadiran Siswa", icon: Clock },
    { id: "materi", label: "Materi Ajar", icon: BookOpen },
    { id: "ujian-online", label: "Ujian Online", icon: FileEdit },
  ];

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? "20%" : "-20%",
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? "20%" : "-20%",
      opacity: 0,
    }),
  };

  const springConfig = {
    type: "spring",
    stiffness: 180,
    damping: 24,
    mass: 1,
  };

  const handleFileChange = (e: any) => {
    const file: File | null = e.target.files?.[0] || null;
    setUploadMessage(null);
    if (file) {
      if (!file.type || !file.type.startsWith("image/")) {
        setUploadMessage({
          text: "Hanya menerima file gambar / foto (JPG/PNG).",
          type: "error",
        });
        setSelectedFile("");
        e.target.value = ""; // reset
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        setUploadMessage({
          text: "Ukuran maksimal file adalah 2MB.",
          type: "error",
        });
        setSelectedFile("");
        e.target.value = ""; // reset
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setSelectedFile(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile || !selectedTugas) {
      setUploadMessage({
        text: "Silakan pilih file gambar terlebih dahulu.",
        type: "error",
      });
      return;
    }

    setIsUploading(true);
    setUploadMessage({
      text: "Mengompresi dan mengunggah gambar...",
      type: "warning",
    });

    try {
      const base64Data = selectedFile;
      const submissionId = `SUB-${student.nisn}-${selectedTugas.id}`;
      const existingSub = submissionsList.find((s: any) => s.id === submissionId);
      const initialSubmittedAt = existingSub?.submittedAt || existingSub?.createdAt || new Date().toISOString();
      const nowIso = new Date().toISOString();

      const isPerbaikan = !!existingSub && (existingSub.status === "ditolak" || existingSub.wasRejected === true || !!existingSub.keterangan);

      const newSubmissionObj = {
        id: submissionId,
        assignmentId: selectedTugas.id,
        nisn: student.nisn,
        studentName: student.name || student.displayName || "Siswa",
        kelas: student.kelas || null,
        fileName: "tugas_gambar.jpg",
        fileUrl: base64Data, // Save Base64 data as the URL for demo
        submittedAt: initialSubmittedAt,
        updatedAt: nowIso,
        resubmittedAt: isPerbaikan ? nowIso : null,
        wasRejected: isPerbaikan || existingSub?.wasRejected || false,
        status: "menunggu penilaian guru",
      };

      // Optimistic update
      mutateSubmissions([...submissionsList.filter((s: any) => s.id !== submissionId), newSubmissionObj], false);

      await setDoc(
        doc(db, "submissions", submissionId),
        newSubmissionObj,
        { merge: true },
      );

      trackUsage(0, 1); // Track write
      mutateSubmissions(); // Refetch properly

      setUploadMessage({
        text: "Tugas berhasil dikumpulkan!",
        type: "success",
      });
      setTimeout(() => {
        setIsUploadModalOpen(false);
        setUploadMessage(null);
        setSelectedFile(null);
      }, 2000);
    } catch (error: any) {
      if (error?.message?.includes("too large")) {
        setUploadMessage({
          text: "Ukuran file terlalu besar untuk database. Coba kecilkan ukuran foto.",
          type: "error",
        });
      } else {
        setUploadMessage({
          text: "Terjadi kesalahan saat mengumpulkan tugas.",
          type: "error",
        });
      }
      console.warn(error);
    } finally {
      setIsUploading(false);
    }
  };

  const isExamOn = activeExam && !examResult;

  if (!student) {
    return (
      <div className="min-h-screen bg-slate-550 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#85cc00] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-500 text-sm font-medium">Memverifikasi Hak Akses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-700 relative">
      <NotificationModal
        {...modalConfig}
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
      />

      {/* LUXURIOUS DESKTOP SIDEBAR */}
      {!isExamOn && (
        <aside className={`hidden md:flex flex-col bg-sky-100 text-slate-700 shrink-0 border-r border-sky-200 z-30 relative shadow-xl ${
          isDesktopSidebarOpen ? "w-64" : "hidden w-0 overflow-hidden border-r-0"
        }`}>
        {/* Collapse Button floating on the right center edge of the sidebar */}
        {isDesktopSidebarOpen && (
          <button
            onClick={() => setIsDesktopSidebarOpen(false)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-50 hidden md:flex h-12 w-8 items-center justify-center rounded-r-2xl bg-sky-400 text-white shadow-lg hover:bg-sky-500 hover:w-10 translate-x-full transition-all cursor-pointer border-y border-r border-sky-200"
            title="Sembunyikan Menu"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* Branding school & app name */}
        <div className="h-20 px-6 flex items-center gap-3 border-b border-sky-200/60 bg-gradient-to-br from-[#85cc00]/22 via-emerald-50/30 to-sky-50/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 flex items-center justify-center shrink-0">
              <img loading="lazy" 
                src={getDriveImageUrl("https://drive.google.com/file/d/1P395tuZymxs3qero4XduMpHy7g2GJrdR/view?usp=sharing")}
                alt="Logo Sekolah"
                className="w-full h-full object-contain animate-pulse-slow"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex flex-col">
              <h1 className="text-md font-black text-slate-800 tracking-tight leading-none">
                SiPinter Apps
              </h1>
              <span className="text-[10px] font-bold text-emerald-700 mt-1 uppercase tracking-wider">
                Siswa Dashboard
              </span>
            </div>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1 custom-scrollbar">
          {menus.map((m, idx) => {
            const isActive = activeMenu === m.id;
            const MenuIcon = m.icon;
            return (
              <button
                key={`m-desk-${m.id || idx}-${idx}`}
                onClick={() => {
                  if (isExamOn) {
                    setPendingNavAction({ type: "menu_change", targetId: m.id, targetIdx: idx });
                    setShowExitWarningModal(true);
                    return;
                  }
                  handleMenuChange(m.id, idx);
                }}
                className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isActive
                    ? "bg-[#85cc00] text-slate-900 shadow-md shadow-[#85cc00]/20"
                    : "text-sky-700 hover:text-sky-900 hover:bg-sky-200"
                }`}
              >
                <MenuIcon className={`w-5 h-5 shrink-0 ${isActive ? "text-slate-950" : "text-sky-600 group-hover:text-sky-900"}`} />
                <span className="truncate">{m.id === "dashboard" ? "Beranda" : m.label}</span>
              </button>
            );
          })}
        </div>
        
        {/* Sidebar Footer Logout */}
        <div className="p-4 border-t border-sky-200">
          <button
            onClick={() => {
              if (isExamOn) {
                setPendingNavAction({ type: "logout_attempt" });
                setShowExitWarningModal(true);
                return;
              }
              handleLogout();
            }}
            className="w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-blue-100/70 hover:text-white hover:bg-white/10 text-sm font-medium transition-all cursor-pointer"
          >
            <LogOut className="w-5 h-5 shrink-0" />
            Keluar
          </button>
        </div>
      </aside>
      )}

      {/* MOBILE DRAWER SIDEBAR (SLIDE OVERLAY) */}
      {!isExamOn && (
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-md z-[90] md:hidden"
            />
            <motion.aside 
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0 }}
              className="fixed top-0 bottom-0 left-0 w-[240px] bg-sky-50 text-slate-700 flex flex-col z-[100] md:hidden border-r border-slate-200 shadow-2xl"
            >
              {/* Floating Close Button in the vertical center of the sidebar's right edge */}
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="absolute right-0 top-1/2 -translate-y-1/2 z-50 flex md:hidden h-12 w-8 items-center justify-center rounded-r-2xl bg-sky-500 text-white shadow-lg hover:bg-sky-600 hover:w-10 translate-x-full transition-all cursor-pointer border-y border-r border-sky-400/20"
                title="Sembunyikan Menu"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <div className="p-6 flex items-center border-b border-[#85cc00]/25 bg-gradient-to-br from-[#85cc00]/22 via-emerald-50/20 to-sky-50/70">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 flex items-center justify-center shrink-0">
                    <img loading="lazy" 
                      src={getDriveImageUrl("https://drive.google.com/file/d/1P395tuZymxs3qero4XduMpHy7g2GJrdR/view?usp=sharing")}
                      alt="Logo"
                      className="w-full h-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="flex flex-col">
                    <h1 className="text-md font-black text-slate-800 tracking-tight leading-none">
                      SiPinter Apps
                    </h1>
                    <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-widest mt-0.5">
                      SMAN 1 Cililin
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-1.5 custom-scrollbar">
                {menus.map((m, idx) => {
                  const isActive = activeMenu === m.id;
                  const MenuIcon = m.icon;
                  return (
                    <button
                      key={`m-mob-${m.id || idx}-${idx}`}
                      onClick={() => {
                        if (isExamOn) {
                          setPendingNavAction({ type: "menu_change", targetId: m.id, targetIdx: idx });
                          setShowExitWarningModal(true);
                          return;
                        }
                        handleMenuChange(m.id, idx);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black tracking-wide uppercase transition-all duration-200 cursor-pointer ${
                        isActive
                          ? "bg-[#85cc00] text-slate-950 shadow-md shadow-[#85cc00]/20"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <MenuIcon className={`w-4.5 h-4.5 shrink-0 ${isActive ? "text-slate-950" : "text-slate-400"}`} />
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="p-4 border-t border-slate-200">
                <button
                  onClick={() => {
                    if (isExamOn) {
                      setPendingNavAction({ type: "logout_attempt" });
                      setShowExitWarningModal(true);
                      return;
                    }
                    handleLogout();
                  }}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl text-rose-500 bg-rose-500/10 text-xs font-black uppercase tracking-wider"
                >
                  <LogOut className="w-4 h-4" />
                  Keluar
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      )}

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">

      {/* Main Content */}
        {/* Notifications Modal */}
        <AnimatePresence>
          {isNotificationsOpen && (
            <motion.div 
              key="notification-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md"
              onClick={() => {
                if (showNotifications.length > 0) {
                  handleDismissAllNotifications();
                } else {
                  setIsNotificationsOpen(false);
                }
              }}
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-3xl border-2 border-slate-300 p-8 max-w-md w-full shadow-2xl overflow-hidden animate-in fade-in duration-300"
              >
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-[#85cc00]/10 rounded-xl">
                        <Bell className="w-5 h-5 text-[#85cc00]" />
                      </div>
                      <h3 className="font-display font-bold text-xl text-slate-900 tracking-tight">Pemberitahuan</h3>
                    </div>
                    <button 
                      onClick={() => {
                        if (showNotifications.length > 0) {
                          handleDismissAllNotifications();
                        } else {
                          setIsNotificationsOpen(false);
                        }
                      }} 
                      className="text-slate-400 hover:text-slate-900 transition-all p-2 hover:bg-slate-50 rounded-xl active:scale-95 cursor-pointer"
                    >
                      <X className="w-5 h-5"/>
                    </button>
                  </div>

                  <div className="space-y-3.5 max-h-[50vh] overflow-y-auto pr-1 mb-8">
                    {showNotifications.length === 0 ? (
                      <div className="py-12 text-center">
                        <Bell className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                        <p className="text-sm font-medium text-slate-500 italic">
                          Tidak ada pemberitahuan baru saat ini.
                        </p>
                      </div>
                    ) : (
                      showNotifications.map((n, i) => {
                        const isRejected = n.type === "rejected";
                        const isGraded = n.type === "graded";
                        const isNewAssignment = n.type === "new_assignment";
                        const isNearDeadline = n.type === "near_deadline";

                        let bgClass = "bg-slate-50 border-slate-100";
                        let iconClass = "bg-slate-100 text-slate-600";
                        let titleColor = "text-slate-950";
                        let icon = <Award className="w-5 h-5" />;

                        if (isRejected) {
                          bgClass = "bg-rose-50 border-rose-100";
                          iconClass = "bg-rose-100 text-rose-600";
                          titleColor = "text-rose-950";
                          icon = <AlertCircle className="w-5 h-5" />;
                        } else if (isGraded) {
                          bgClass = "bg-emerald-50 border-emerald-100";
                          iconClass = "bg-emerald-100 text-emerald-600";
                          titleColor = "text-emerald-950";
                          icon = <Award className="w-5 h-5" />;
                        } else if (isNewAssignment) {
                          bgClass = "bg-sky-50 border-sky-100";
                          iconClass = "bg-sky-100 text-sky-600";
                          titleColor = "text-sky-950";
                          icon = <Sparkles className="w-5 h-5" />;
                        } else if (isNearDeadline) {
                          bgClass = "bg-amber-50 border-amber-100";
                          iconClass = "bg-amber-100 text-amber-600";
                          titleColor = "text-amber-950";
                          icon = <Clock className="w-5 h-5" />;
                        }

                        return (
                          <div
                            key={`notif-${n.id || i}-${i}`}
                            className={`p-5 rounded-2xl border-2 ${bgClass} flex items-start justify-between gap-4 shadow-sm hover:shadow-md transition-shadow duration-300 relative group`}
                          >
                            <div className="flex items-start gap-4 flex-1 min-w-0">
                              <div className={`mt-0.5 p-2 rounded-xl shrink-0 ${iconClass}`}>
                                {icon}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-black tracking-tight ${titleColor}`}>
                                  {n.title}
                                </p>
                                <p className="text-xs text-slate-700 font-medium mt-1 leading-relaxed break-words">
                                  {n.message}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDismissNotification(n.id)}
                              className="text-slate-400 hover:text-rose-600 p-1.5 hover:bg-white rounded-lg transition-all active:scale-95 cursor-pointer shrink-0 align-middle self-center"
                              title="Hapus pemberitahuan"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="flex gap-3">
                    {showNotifications.length > 0 && (
                      <button
                        onClick={handleDismissAllNotifications}
                        className="flex-1 rounded-2xl bg-black px-4 py-3.5 text-center text-[12px] font-black uppercase tracking-wider text-white hover:bg-slate-850 active:scale-95 transition-all font-display cursor-pointer"
                      >
                        Hapus Semua
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (showNotifications.length > 0) {
                          handleDismissAllNotifications();
                        } else {
                          setIsNotificationsOpen(false);
                        }
                      }}
                      className={`rounded-2xl border-2 border-slate-200 px-5 py-3.5 text-center text-[12px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-100 hover:text-black active:scale-95 transition-all font-display cursor-pointer ${
                        showNotifications.length === 0 ? "w-full" : ""
                      }`}
                    >
                      Tutup
                    </button>
                  </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Profile Photo Update Modal */}
        <AnimatePresence>
          {isProfileModalOpen && (
            <motion.div 
              key="profile-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[120] flex items-center justify-center p-4"
            >
              <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md"
                   onClick={() => setIsProfileModalOpen(false)}></div>
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white rounded-3xl border-2 border-slate-300 p-8 max-w-md w-full shadow-2xl overflow-hidden relative z-10"
              >
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-[#85cc00]/10 rounded-xl">
                        <User className="w-5 h-5 text-[#85cc00]" />
                      </div>
                      <h3 className="font-display font-bold text-xl text-slate-900 tracking-tight">Update Profil</h3>
                    </div>
                    <button 
                      onClick={() => setIsProfileModalOpen(false)} 
                      className="text-slate-400 hover:text-slate-900 transition-all p-2 hover:bg-slate-50 rounded-xl active:scale-95 cursor-pointer"
                    >
                      <X className="w-5 h-5"/>
                    </button>
                  </div>

                  <div className="space-y-4 mb-8">
                    {/* Live Preview Avatar */}
                    <div className="flex flex-col items-center justify-center my-2 p-3 bg-slate-50 rounded-2xl border border-slate-200/80">
                      <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-[#85cc00] shadow-md bg-white flex items-center justify-center relative">
                        {tempPhotoUrl.trim() ? (
                          <img
                            src={getDriveImageUrl(tempPhotoUrl.trim())}
                            alt="Pratinjau Foto"
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80";
                            }}
                          />
                        ) : (
                          <User className="w-12 h-12 text-slate-400" />
                        )}
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-2">Pratinjau Foto Profil</p>
                    </div>

                    {student.profilePhotoUrl && (
                      <div className="flex justify-end mb-1">
                        <button
                          onClick={() => {
                            showConfirm(
                              "Hapus Foto Profil",
                              "Apakah Anda yakin ingin menghapus foto profil saat ini?",
                              async () => {
                                setIsSaving(true);
                                try {
                                  const { id, ...dataToSave } = student;
                                  const updatedStudent = { ...dataToSave, profilePhotoUrl: "" };
                                  await setDoc(doc(db, "studentsByNisn", student.id), updatedStudent, { merge: true });
                                  setStudent({ id, ...updatedStudent });
                                  try {
                                    localStorage.setItem("current_student", JSON.stringify({ id, ...updatedStudent }));
                                  } catch (e) { console.warn("Error parsing stored data:", e); }
                                  setTempPhotoUrl("");
                                  setIsProfileLinkDisabled(false);
                                  showAlert("Berhasil", "Foto profil Anda telah dihapus.", "alert");
                                  setIsProfileModalOpen(false);
                                } catch (error) {
                                  showAlert("Kesalahan", "Gagal menghapus foto", "danger");
                                } finally {
                                  setIsSaving(false);
                                }
                              }
                            );
                          }}
                          disabled={isSaving}
                          className="text-rose-500 hover:text-rose-600 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 group transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 group-hover:rotate-12 transition-transform" /> Hapus Foto
                        </button>
                      </div>
                    )}
                    
                    <input
                      type="url"
                      placeholder="Tempel Link Foto (Google Drive/Lainnya)"
                      className="w-full bg-white border border-slate-200 rounded-xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#85cc00]/20 disabled:bg-slate-100 disabled:opacity-50 font-sans"
                      value={tempPhotoUrl}
                      onChange={(e) => setTempPhotoUrl(e.target.value)}
                      disabled={isProfileLinkDisabled}
                    />
                  </div>

                  <div className="flex gap-3">
                    {isProfileLinkDisabled ? (
                      <button
                        onClick={() => setIsProfileLinkDisabled(false)}
                        className="flex-1 rounded-2xl bg-amber-500 text-white px-4 py-3.5 text-center text-[12px] font-black uppercase tracking-wider hover:bg-amber-600 active:scale-95 transition-all font-display cursor-pointer"
                      >
                        Edit Link
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          const cleanUrl = tempPhotoUrl.trim();
                          if (!cleanUrl) {
                            showAlert("Perhatian", "Silakan masukkan URL foto terlebih dahulu", "danger");
                            return;
                          }
                          setIsSaving(true);
                          try {
                            const { id, ...dataToSave } = student;
                            const updatedStudent = { ...dataToSave, profilePhotoUrl: cleanUrl };
                            await setDoc(doc(db, "studentsByNisn", student.id), updatedStudent, { merge: true });
                            const fullUpdated = { id, ...updatedStudent };
                            setStudent(fullUpdated);
                            try {
                              localStorage.setItem("current_student", JSON.stringify(fullUpdated));
                            } catch (e) { console.warn("Error parsing stored data:", e); }
                            setIsProfileLinkDisabled(true);
                            showAlert("Berhasil", "Foto profil berhasil diperbarui", "alert");
                          } catch (e) {
                            showAlert("Kesalahan", "Gagal menyimpan foto profil", "danger");
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                        disabled={isSaving}
                        className="flex-1 rounded-2xl bg-[#85cc00] text-slate-900 px-4 py-3.5 text-center text-[12px] font-black uppercase tracking-wider hover:brightness-110 active:scale-95 transition-all font-display cursor-pointer"
                      >
                        {isSaving ? "Menyimpan..." : "Simpan"}
                      </button>
                    )}
                  </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden relative z-0">
        {/* Floating pull-tab when sidebar is closed on desktop */}
        {(!isDesktopSidebarOpen || !isSidebarOpen) && (
          <button
            onClick={() => setIsDesktopSidebarOpen(true)}
            className="fixed left-0 top-1/2 -translate-y-1/2 z-40 hidden md:flex h-12 w-8 items-center justify-center rounded-r-2xl bg-sky-500 text-white shadow-lg hover:bg-sky-600 hover:w-10 transition-all cursor-pointer border-y border-r border-sky-400/20"
            title="Tampilkan Menu"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {/* Floating pull-tab when mobile drawer is closed */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="fixed left-0 top-1/2 -translate-y-1/2 z-40 flex md:hidden h-12 w-8 items-center justify-center rounded-r-2xl bg-sky-500 text-white shadow-lg hover:bg-sky-600 hover:w-10 transition-all cursor-pointer border-y border-r border-sky-400/20"
            title="Tampilkan Menu"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}

        {!isExamOn && (
        <header className="flex h-20 flex-shrink-0 items-center justify-between bg-gradient-to-r from-[#85cc00]/15 via-[#85cc00]/5 to-slate-50 px-4 sm:px-8 border-b border-slate-200 shadow-sm sticky top-0 z-50">
          <div className="flex items-center gap-4">
            {/* Hamburger button deleted per user request ("Hapus garis 3") */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center shrink-0 w-12 h-12 transition-all duration-300 hover:scale-105">
                 <img loading="lazy" 
                   src={getDriveImageUrl("https://drive.google.com/file/d/1P395tuZymxs3qero4XduMpHy7g2GJrdR/view?usp=sharing")}
                   alt="Logo Si Pinter"
                   className="w-full h-full object-contain"
                   referrerPolicy="no-referrer"
                 />
              </div>
              <div className="flex flex-col">
                <h1 className="text-lg sm:text-2xl font-brand font-black text-[#85cc00] tracking-tight leading-none whitespace-nowrap">SiPinter Apps</h1>
                <span className="text-[9px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mt-0.5 whitespace-nowrap">SMA Negeri 1 Cililin</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Refresh / Segarkan Data */}
            <button
               onClick={() => {
                 if (isExamOn) return;
                 handleManualRefresh();
               }}
               disabled={isRefreshingData || isExamOn}
               className={`flex items-center justify-center w-12 h-12 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-[#85cc00] transition-all relative shadow-sm ${isExamOn ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
               title="Segarkan / Update Data"
            >
              <RefreshCw className={`h-5 w-5 ${isRefreshingData ? "animate-spin text-[#85cc00]" : ""}`} />
            </button>

            {/* Notification */}
            <button
               onClick={() => {
                 if (isExamOn) {
                   setPendingNavAction({ type: "sidebar_attempt" });
                   setShowExitWarningModal(true);
                   return;
                 }
                 setIsNotificationsOpen(true);
               }}
               className={`flex items-center justify-center w-12 h-12 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-[#85cc00] transition-colors relative shadow-sm ${isExamOn ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
               title="Pemberitahuan"
            >
              <Bell className="h-5 w-5" />
              {showNotifications.length > 0 && (
                <span className="absolute top-2 right-2 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-rose-500 border border-white">
                </span>
              )}
            </button>

            {/* Profile Photo & Name */}
            <button
               onClick={() => {
                 if (isExamOn) {
                   setPendingNavAction({ type: "sidebar_attempt" });
                   setShowExitWarningModal(true);
                   return;
                 }
                 setTempPhotoUrl(student?.profilePhotoUrl || "");
                 setIsProfileLinkDisabled(!!student?.profilePhotoUrl);
                 setIsProfileModalOpen(true);
               }}
               className={`flex flex-col items-center justify-center hover:opacity-80 transition-all ${isExamOn ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}
               title="Profil Akun"
            >
               <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e4e6eb] text-[#85cc00] shadow-sm border border-slate-200 overflow-hidden shrink-0">
                 <div className="flex h-full w-full items-center justify-center rounded-full">
                 {student?.profilePhotoUrl ? (
                   <img loading="lazy" 
                     src={getDriveImageUrl(student.profilePhotoUrl)} 
                     alt="Avatar" 
                     className="w-full h-full object-cover rounded-full"
                     referrerPolicy="no-referrer"
                   />
                 ) : (
                   <User className="w-[120%] h-[120%] text-[#aeb4bb] translate-y-1.5" fill="currentColor" />
                 )}
               </div>
               </div>
            </button>

            {/* Logout */}
            <button
              onClick={() => setShowLogoutModal(true)}
              className="flex flex-col items-center justify-center hover:opacity-80 transition-all cursor-pointer"
              title="Keluar"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-500 text-white shadow-sm hover:bg-rose-600 active:scale-95 transition-all border border-slate-200">
                <Power className="w-5 h-5" />
              </div>
            </button>
          </div>
        </header>
        )}

        <div className="flex-1 overflow-x-hidden overflow-y-auto bg-gradient-to-br from-emerald-50/60 via-slate-50 to-[#85cc00]/15 p-6 sm:p-8 md:p-12 relative">
          {/* Decorative background green glow blobs (gradasi pada sela-sela frame agar tidak polos) */}
          <div className="absolute top-10 left-10 w-96 h-96 rounded-full bg-gradient-to-br from-[#85cc00]/15 to-emerald-400/5 blur-3xl pointer-events-none z-0" />
          <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-gradient-to-tr from-emerald-500/15 to-[#85cc00]/5 blur-3xl pointer-events-none z-0" />
          <div className="absolute top-1/2 left-1/3 w-[500px] h-[500px] rounded-full bg-gradient-to-r from-emerald-200/10 to-[#85cc00]/10 blur-3xl pointer-events-none z-0" />

          <div className="mx-auto w-full max-w-full px-4 sm:px-6 md:px-8 py-4 relative z-10">
            {isOffline && (
              <div className="mb-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl px-5 py-4 text-xs font-semibold text-amber-800 flex items-center gap-3 animate-in slide-in-from-top duration-300">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                </span>
                <div>
                  <p className="font-bold text-amber-950">Akses Data Terhambat (Mode Offline)</p>
                  <p className="text-amber-700/90 font-medium mt-0.5">Sistem memuat sinkronisasi tersimpan dari memori lokal karena koneksi server lambat.</p>
                </div>
              </div>
            )}
          {examResult ? (
            <div className="bg-white rounded-[2.5rem] p-8 md:p-16 border border-slate-200 text-center shadow-xl shadow-slate-200/50 w-full max-w-2xl mx-auto animate-in zoom-in-95 duration-500">
              <div className="w-24 h-24 mx-auto bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center shadow-inner mb-8">
                <CheckCircle2 className={`w-12 h-12 ${examResult.passed ? 'text-emerald-500' : 'text-rose-500'}`} />
              </div>
              <p className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">Hasil Evaluasi</p>
              <h2 className="text-4xl font-display font-medium text-slate-900 tracking-tight leading-none mb-6">
                Ujian Selesai
              </h2>
              {examResult.wasTimeOut && (
                <div className="inline-block px-4 py-2 bg-amber-50 rounded-xl border border-amber-100 text-amber-600 text-xs font-black uppercase mb-8 tracking-wider">
                  Waktu Ujian Habis
                </div>
              )}
              
              <div className="space-y-4 max-w-sm mx-auto">
                <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500 uppercase">Judul Ujian</span>
                  <span className="text-sm font-bold text-slate-900">{examResult.examTitle || "Ujian"}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-xs font-bold text-slate-500 uppercase">Bab Pelajaran</span>
                  <span className="text-sm font-bold text-slate-900">
                    {examResult.bab || (examResult.examTitle?.includes(" - ") ? examResult.examTitle.split(" - ")[1] : "Informatika")}
                  </span>
                </div>
                <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-black text-slate-500 uppercase">Nilai Akhir</span>
                  <span className="text-2xl font-black text-slate-900">{examResult.score}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200">
                  <span className="text-xs font-black text-slate-500 uppercase">Status</span>
                  <span className={`text-sm font-black uppercase tracking-widest ${examResult.passed ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {examResult.passed ? 'Memenuhi KKM' : 'Belum Lulus'}
                  </span>
                </div>
              </div>

              <div className="mt-12">
                <button
                  onClick={() => {
                    setExamResult(null);
                    setActiveExam(null);
                    setActiveMenu("ujian-online");
                  }}
                  className="px-8 py-4 bg-[#85cc00] shadow-md shadow-[#85cc00]/20 hover:bg-[#72b000] active:scale-95 text-black font-black uppercase text-xs tracking-widest rounded-xl transition-all border border-slate-900/10"
                >
                  Kembali ke Dashboard
                </button>
              </div>
            </div>
          ) : !isExamOn ? (
            <>
              <div
                key={activeMenu}
                className={`${
                  activeMenu === "dashboard"
                    ? "bg-transparent border-none shadow-none p-0"
                    : "rounded-[1.5rem] sm:rounded-[2.5rem] border border-slate-200 bg-gradient-to-br from-white via-[#85cc00]/3 to-[#85cc00]/14 p-4 sm:p-6 md:p-8 md:p-12 shadow-xl shadow-slate-200/50 relative overflow-hidden"
                }`}
              >
                {activeMenu !== "dashboard" && (
                  <>
                    <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-gradient-to-bl from-[#85cc00]/12 to-transparent blur-3xl pointer-events-none z-0" />
                    <div className="absolute -bottom-10 -left-10 w-80 h-80 rounded-full bg-gradient-to-tr from-[#85cc00]/10 to-transparent blur-3xl pointer-events-none z-0" />
                  </>
                )}
               {activeMenu === "dashboard" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  {/* Status Banner (Sakit/Izin/Alpa Hari Ini) */}
                  <AnimatePresence>
                    {todayAttendance && dismissedStatusDate !== todayAttendance.date && (
                      <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className={`p-5 rounded-3xl border flex items-start gap-4 shadow-lg ${
                          todayAttendance.type === "hadir"
                            ? "bg-emerald-50 border-emerald-100 text-emerald-900"
                            : todayAttendance.type === "sakit" 
                            ? "bg-blue-50 border-blue-100 text-blue-900" 
                            : todayAttendance.type === "izin"
                            ? "bg-amber-50 border-amber-100 text-amber-900"
                            : todayAttendance.type === "dispen"
                            ? "bg-purple-50 border-purple-100 text-purple-900"
                            : "bg-rose-50 border-rose-100 text-rose-900"
                        }`}
                      >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                          todayAttendance.type === "hadir"
                            ? "bg-emerald-500 text-white"
                            : todayAttendance.type === "sakit" 
                            ? "bg-blue-500 text-white" 
                            : todayAttendance.type === "izin"
                            ? "bg-amber-500 text-white"
                            : todayAttendance.type === "dispen"
                            ? "bg-purple-500 text-white"
                            : "bg-rose-500 text-white"
                        }`}>
                          {todayAttendance.type === "hadir" ? (
                            <CheckCircle2 className="w-6 h-6" />
                          ) : todayAttendance.type === "sakit" ? (
                            <HeartPulse className="w-6 h-6" />
                          ) : todayAttendance.type === "izin" ? (
                            <FileText className="w-6 h-6" />
                          ) : todayAttendance.type === "dispen" ? (
                            <ShieldCheck className="w-6 h-6" />
                          ) : (
                            <AlertOctagon className="w-6 h-6" />
                          )}
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-black uppercase tracking-widest mb-1">
                            {todayAttendance.title}
                          </h4>
                          <p className="text-sm font-bold opacity-80 leading-relaxed">
                            {todayAttendance.text}
                          </p>
                        </div>
                        <button 
                          onClick={() => handleDismissStatusBanner(todayAttendance.date)}
                          className="p-2 text-slate-500 hover:bg-white/50 hover:text-slate-900 rounded-lg transition-colors cursor-pointer"
                          title="Tutup Peringatan"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Peringatan Tugas Berhasil Dinilai (Graded Tasks Banner - Frame Hijau) */}
                  {gradedTaskAlerts.length > 0 && (
                    <div className="space-y-4 mb-6">
                      {gradedTaskAlerts.map((item, idx) => (
                        <div
                          key={`graded-alert-${item.alertId}_${idx}`}
                          className="p-5 sm:p-6 rounded-3xl bg-emerald-50/90 border-2 border-emerald-300 text-emerald-950 shadow-lg shadow-emerald-500/10 flex flex-col md:flex-row md:items-center justify-between gap-5 animate-in slide-in-from-top-4 duration-300 relative overflow-hidden"
                        >
                          <div className="flex items-start gap-4 flex-1">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                              <CheckCircle className="w-6 h-6 stroke-[2.5]" />
                            </div>
                            <div className="space-y-2.5 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[11px] font-black uppercase tracking-wider bg-emerald-600 text-white px-3 py-1 rounded-full shadow-2xs flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5" />
                                  Tugas Berhasil Dinilai 🎉
                                </span>
                                <span className="text-xs font-black bg-emerald-100 text-emerald-900 border border-emerald-300 px-3 py-1 rounded-full flex items-center gap-1">
                                  Nilai: <strong className="text-emerald-950 font-black text-sm">{item.score}</strong> / 100
                                </span>
                              </div>

                              <h4 className="text-base font-black text-slate-900 tracking-tight">
                                {item.materi} <span className="text-xs font-bold text-slate-500">({item.bab})</span>
                              </h4>

                              {/* Kata-kata Membangun */}
                              <div className="bg-white/80 border border-emerald-200 rounded-2xl p-3.5 text-xs font-extrabold text-emerald-800 leading-relaxed shadow-3xs">
                                &ldquo;{item.motivationalQuote}&rdquo;
                              </div>

                              {/* Catatan Guru (jika ada) */}
                              {item.catatanGuru && (
                                <div className="bg-emerald-100/70 border border-emerald-200/90 rounded-xl p-3 text-xs text-emerald-950 leading-relaxed">
                                  <span className="font-extrabold text-emerald-950 block mb-0.5">Catatan/Feedback Guru:</span>
                                  &ldquo;{item.catatanGuru}&rdquo;
                                </div>
                              )}

                              {/* Tanggal Rilis & Tanggal Penyerahan */}
                              <div className="flex flex-wrap items-center gap-y-2 gap-x-4 pt-1 text-[11px] font-bold text-slate-600">
                                <div className="flex items-center gap-1.5 bg-white border border-emerald-200 px-3 py-1.5 rounded-xl shadow-3xs">
                                  <Calendar className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Tanggal Rilis Tugas: <strong className="text-slate-900">{item.tanggalRilis}</strong></span>
                                </div>
                                <div className="flex items-center gap-1.5 bg-white border border-emerald-200 px-3 py-1.5 rounded-xl shadow-3xs">
                                  <Send className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span>Tanggal Penyerahan: <strong className="text-slate-900">{item.tanggalPenyerahan}</strong></span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Tombol Tutup */}
                          <div className="flex items-center gap-2 self-end md:self-center shrink-0 pt-2 md:pt-0">
                            <button
                              onClick={() => handleDismissGradedAlert(item.alertId)}
                              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-2 border border-emerald-600"
                              title="Tutup pemberitahuan ini"
                            >
                              <X className="w-4 h-4" />
                              Tutup
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Peringatan Tugas Ditolak (Rejected Tasks Banner) */}
                  {rejectedTasks.length > 0 && (
                    <div className="space-y-4 mb-6">
                      {rejectedTasks.map((task, idx) => (
                        <div 
                          key={`rejected-alert-${task.id || idx}_${idx}`}
                          className="p-5 rounded-3xl bg-rose-50 border border-rose-200 text-rose-900 shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-300"
                        >
                          <div className="flex items-start gap-4 flex-1">
                            <div className="w-12 h-12 rounded-2xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                              <AlertOctagon className="w-6 h-6" />
                            </div>
                            <div className="space-y-1">
                              <h4 className="text-xs font-black uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
                                Tugas Ditolak Guru ❌
                              </h4>
                              <p className="text-sm font-extrabold text-slate-800">
                                {task.materi} ({task.bab})
                              </p>
                              <div className="bg-white border border-rose-100 rounded-xl p-3 text-xs text-slate-700 mt-2 leading-relaxed shadow-3xs">
                                <span className="font-bold text-rose-600 block mb-0.5">Alasan Penolakan:</span>
                                &ldquo;{task.submission?.keterangan || task.submission?.feedback || "Tidak ada alasan spesifik yang dicantumkan."}&rdquo;
                              </div>
                              <p className="text-[11px] font-bold text-rose-700 mt-2 flex items-center gap-1">
                                💡 Silakan perbaiki tugas Anda dan unggah ulang berkas/tautan yang benar sekarang agar guru dapat memberikan nilai.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                            <button
                              onClick={() => {
                                setSelectedTugas(task);
                                setSelectedFile(task.submission?.fileUrl || "");
                                setIsUploadModalOpen(true);
                              }}
                              className="px-4 py-2 bg-slate-900 text-white hover:bg-[#85cc00] hover:text-slate-900 font-black uppercase tracking-widest text-[10px] rounded-xl transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                            >
                              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                              Unggah Ulang
                            </button>
                            <button
                              onClick={() => setViewingTugas(task)}
                              className="px-3.5 py-2 bg-white text-rose-600 hover:bg-rose-100 border border-rose-200 font-extrabold text-[10px] rounded-xl transition-all shadow-sm cursor-pointer"
                            >
                              Detail Tugas
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Greeting & Date */}
                  <div className="relative overflow-hidden bg-gradient-to-r from-[#85cc00] via-emerald-500 to-emerald-600 rounded-3xl p-6 sm:p-8 text-white shadow-lg shadow-[#85cc00]/25 mb-8 mt-4 border border-[#85cc00]/30">
                    {/* Decorative abstract circle shapes */}
                    <div className="absolute right-0 top-0 -translate-y-12 translate-x-12 w-64 h-64 rounded-full bg-white/10 blur-xl pointer-events-none"></div>
                    <div className="absolute left-1/3 bottom-0 translate-y-12 w-48 h-48 rounded-full bg-emerald-400/20 blur-xl pointer-events-none"></div>

                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex-1">
                        <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight leading-tight flex items-center gap-2 text-white">
                          Selamat Datang, {student?.displayName || "Siswa"} <span className="text-2xl inline-block origin-bottom-right hover:animate-pulse">👋</span>
                        </h2>
                        <p className="text-xs sm:text-sm font-medium text-emerald-50 mt-1.5 max-w-xl">
                          Semangat belajar hari ini, raih masa depan yang gemilang bersama SiPinter Apps SMA Negeri 1 Cililin.
                        </p>
                      </div>
                      <div className="flex flex-col items-stretch sm:items-end gap-2.5 self-start md:self-auto shrink-0 w-full sm:w-auto">
                        <div className="flex items-center justify-center gap-2.5 px-4.5 py-2.5 bg-emerald-950/30 backdrop-blur-md border border-white/20 rounded-2xl shadow-sm">
                          <Calendar className="w-4.5 h-4.5 text-white" />
                          <span className="text-xs sm:text-sm font-black uppercase tracking-widest text-white">{formattedToday}</span>
                        </div>
                        <button
                          onClick={() => {
                            if (isExamOn) {
                              setPendingNavAction({ type: "sidebar_attempt" });
                              setShowExitWarningModal(true);
                              return;
                            }
                            window.location.reload();
                          }}
                          className={`flex items-center justify-center gap-2.5 px-4.5 py-2.5 bg-emerald-950/30 hover:bg-emerald-900/50 backdrop-blur-md border border-white/20 rounded-2xl text-white transition-all shadow-sm group ${isExamOn ? "opacity-30 cursor-not-allowed" : "cursor-pointer active:scale-95"}`}
                          title="Muat Ulang Aplikasi (Refresh)"
                        >
                          <RefreshCw className="h-4.5 w-4.5 transition-transform duration-500 group-hover:rotate-180 text-white" />
                          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">Refresh Aplikasi</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Stats Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    {/* Tugas Aktif */}
                    <div className="bg-gradient-to-br from-white to-[#85cc00]/4 hover:to-[#85cc00]/10 hover:scale-[1.02] duration-300 transition-all p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-500 flex items-center justify-center shrink-0">
                          <User className="w-7 h-7" />
                        </div>
                        <div className="flex flex-col">
                          <p className="text-sm font-medium text-slate-500">Tugas Aktif</p>
                          <h3 className="text-3xl font-extrabold bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 bg-clip-text text-transparent mt-1 leading-none">{uncompletedTasksCount}</h3>
                          <button onClick={() => handleMenuChange("daftar-tugas", 2)} className="text-[#85cc00] text-sm font-medium mt-3 flex items-center gap-1 hover:text-emerald-600 w-fit cursor-pointer">
                            Lihat tugas <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Kehadiran */}
                    <div className="bg-gradient-to-br from-white to-[#85cc00]/4 hover:to-[#85cc00]/10 hover:scale-[1.02] duration-300 transition-all p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-purple-100 text-purple-500 flex items-center justify-center shrink-0">
                          <Calendar className="w-7 h-7" />
                        </div>
                        <div className="flex flex-col">
                          <p className="text-sm font-medium text-slate-500">Kehadiran</p>
                          <h3 className="text-3xl font-extrabold bg-gradient-to-r from-purple-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent mt-1 leading-none">{attendanceSummary ? attendanceSummary.percentage : "0"}%</h3>
                          <button onClick={() => handleMenuChange("kehadiran", 4)} className="text-[#85cc00] text-sm font-medium mt-3 flex items-center gap-1 hover:text-emerald-600 w-fit cursor-pointer">
                            Lihat kehadiran <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Main Grid: Left (Tugas & Akses Cepat) / Right (Kehadiran & Ujian) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* LEFT COLUMN */}
                    <div className="md:col-span-2 space-y-6">
                      {/* Tugas Terbaru */}
                      <div className="bg-gradient-to-br from-white to-[#85cc00]/4 p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-lg font-bold text-slate-900">Tugas Terbaru</h3>
                          <button onClick={() => handleMenuChange("daftar-tugas", 2)} className="text-sm font-medium text-[#85cc00] bg-[#85cc00]/10 hover:bg-[#85cc00]/20 px-3 py-1.5 rounded-lg transition-colors cursor-pointer">
                            Lihat Semua
                          </button>
                        </div>
                        <div className="space-y-4">
                          {assignmentsList.slice(0, 4).map((tugas, idx) => {
                            const isSubmitted = submissionsList.some((s) => s.assignmentId === tugas.id);
                            const sub = submissionsList.find((s) => s.assignmentId === tugas.id);
                            const hasGrade = sub && sub.nilai !== undefined && sub.nilai !== null;
                            const colors = ["bg-purple-100 text-purple-600", "bg-orange-100 text-orange-600", "bg-emerald-100 text-emerald-600", "bg-pink-100 text-pink-600"];
                            const borderColors = ["border-purple-300", "border-orange-300", "border-emerald-300", "border-pink-300"];
                            const colorClass = colors[idx % colors.length];
                            const borderColor = borderColors[idx % borderColors.length];
                            
                            return (
                              <div key={`tugas-${tugas.id || idx}-${idx}`} className={`flex items-center justify-between p-4 rounded-xl border-4 ${borderColor} hover:bg-slate-50 transition-colors`}>
                                <div className="flex items-center gap-4 min-w-0">
                                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${colorClass}`}>
                                    <FileText className="w-6 h-6" />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="font-bold text-slate-900 truncate">{tugas.title}</h4>
                                    <p className="text-xs text-slate-500 mt-0.5 truncate">{tugas.description}</p>
                                  </div>
                                </div>
                                <div className="text-right flex flex-col items-end shrink-0">
                                  {hasGrade ? (
                                    <span className="px-2.5 py-1 text-[10px] font-black bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500 text-white rounded-md shadow-sm">Nilai: {sub.nilai} ✓</span>
                                  ) : isSubmitted ? (
                                    <span className="px-2.5 py-1 text-[10px] font-bold bg-blue-50 text-blue-600 rounded-md">Dikumpulkan</span>
                                  ) : (
                                    <span className="px-2.5 py-1 text-[10px] font-bold bg-orange-50 text-orange-600 rounded-md">Belum Dikumpulkan</span>
                                  )}
                                  <span className="text-xs text-slate-400 font-medium mt-1">
                                    {tugas.deadline ? new Date(tugas.deadline).toLocaleDateString("id-ID", {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric"
                                    }) : "-"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          {assignmentsList.length === 0 && (
                             <div className="text-center py-8 text-slate-500">Tidak ada tugas terbaru.</div>
                          )}
                        </div>
                      </div>

                      {/* Akses Cepat */}
                      <div className="bg-gradient-to-br from-white to-[#85cc00]/4 p-6 rounded-2xl border border-slate-200 shadow-sm">
                        <h3 className="text-lg font-bold text-slate-900 mb-6">Akses Cepat</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <button onClick={() => handleMenuChange("materi", 5)} className="flex flex-col items-center justify-center p-6 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors border border-blue-100 cursor-pointer">
                            <BookOpen className="w-8 h-8 text-blue-500 mb-3" />
                            <span className="text-xs font-semibold text-blue-700">Materi Ajar</span>
                          </button>
                          <button onClick={() => handleMenuChange("ujian-online", 6)} className="flex flex-col items-center justify-center p-6 rounded-xl bg-purple-50 hover:bg-purple-100 transition-colors border border-purple-100 cursor-pointer">
                            <MonitorPlay className="w-8 h-8 text-purple-500 mb-3" />
                            <span className="text-xs font-semibold text-purple-700">Ujian Online</span>
                          </button>
                          <button onClick={() => handleMenuChange("nilai-siswa", 2)} className="flex flex-col items-center justify-center p-6 rounded-xl bg-emerald-50 hover:bg-emerald-100 transition-colors border border-emerald-100 cursor-pointer">
                            <LineChart className="w-8 h-8 text-emerald-500 mb-3" />
                            <span className="text-xs font-semibold text-emerald-700">Nilai Siswa</span>
                          </button>
                          <button onClick={() => handleMenuChange("kehadiran", 4)} className="flex flex-col items-center justify-center p-6 rounded-xl bg-orange-50 hover:bg-orange-100 transition-colors border border-orange-100 cursor-pointer">
                            <Calendar className="w-8 h-8 text-orange-500 mb-3" />
                            <span className="text-xs font-semibold text-orange-700">Kehadiran Siswa</span>
                          </button>
                        </div>
                      </div>

                      {/* Motivation Banner */}
                      <div className="bg-gradient-to-r from-[#85cc00] via-emerald-500 to-emerald-600 rounded-2xl p-6 relative overflow-hidden flex items-center shadow-lg shadow-[#85cc00]/15 border border-[#85cc00]/20">
                        <div className="relative z-10 w-full">
                          <h3 className="text-xl font-bold text-white mb-2 max-w-lg">Teruslah berusaha dan jangan menyerah!</h3>
                          <p className="text-emerald-50 text-sm max-w-lg">Kesuksesan adalah hasil dari persiapan, kerja keras, dan belajar dari kegagalan.</p>
                        </div>
                      </div>
                    </div>

                    {/* RIGHT COLUMN */}
                    <div className="space-y-6">
                      {/* Kehadiran Bulan Ini Chart */}
                      <div className="bg-gradient-to-br from-white to-[#85cc00]/4 p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center h-auto">
                        <div className="w-full text-left mb-6">
                           <h3 className="text-lg font-bold text-slate-900">Kehadiran Bulan Ini</h3>
                        </div>
                        
                        {/* Professional Animated Doughnut Chart */}
                        <div className="relative w-48 h-48 mb-8 mt-2 flex items-center justify-center">
                          <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90 drop-shadow-sm">
                            <circle cx="50" cy="50" r="38" fill="transparent" stroke="#f1f5f9" strokeWidth="12" />
                            <circle 
                              cx="50" cy="50" r="38" 
                              fill="transparent" 
                              stroke="#10b981" 
                              strokeWidth="12" 
                              strokeDasharray="238.76" 
                              strokeDashoffset={238.76 - (238.76 * Number(attendanceSummary ? attendanceSummary.percentage : "0")) / 100} 
                              strokeLinecap="round" 
                              className="transition-all duration-1000 ease-out" 
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-4xl font-black bg-gradient-to-r from-teal-500 via-blue-600 to-purple-600 bg-clip-text text-transparent tracking-tighter -mr-1">
                              {attendanceSummary ? attendanceSummary.percentage : "0"}
                              <span className="text-2xl text-slate-400 font-bold">%</span>
                            </span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Hadir</span>
                          </div>
                        </div>
                        
                        <div className="w-full space-y-3">
                          <div className="flex justify-between items-center text-sm">
                            <span className="flex items-center gap-2 text-slate-600 font-medium"><span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"></span> Hadir</span>
                            <span className="font-extrabold text-emerald-600">{attendanceSummary?.Hadir || 0}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="flex items-center gap-2 text-slate-600 font-medium"><span className="w-3 h-3 rounded-full bg-amber-400 shadow-sm shadow-amber-400/20"></span> Izin</span>
                            <span className="font-extrabold text-amber-500">{attendanceSummary?.Izin || 0}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="flex items-center gap-2 text-slate-600 font-medium"><span className="w-3 h-3 rounded-full bg-rose-500 shadow-sm shadow-rose-500/20"></span> Sakit</span>
                            <span className="font-extrabold text-rose-500">{attendanceSummary?.Sakit || 0}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm">
                            <span className="flex items-center gap-2 text-slate-600 font-medium"><span className="w-3 h-3 rounded-full bg-slate-300 shadow-sm shadow-slate-300/50"></span> Alpa</span>
                            <span className="font-extrabold text-slate-500">{attendanceSummary?.Alpa || 0}</span>
                          </div>
                        </div>
                        
                        <div className="w-full mt-8 bg-emerald-50/80 border border-emerald-100 text-emerald-700 p-4 rounded-xl flex items-center justify-between text-sm font-bold shadow-sm">
                          <span>Total Kehadiran: {attendanceSummary ? attendanceSummary.percentage : "0"}%</span>
                          <TrendingUp className="w-4 h-4" />
                        </div>
                      </div>

                      {/* Ujian yang Sudah Dilaksanakan */}
                      <div className="bg-gradient-to-br from-white to-[#85cc00]/4 p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
                        <div className="flex items-center justify-between mb-6">
                          <h3 className="text-lg font-bold text-slate-900">Ujian yang Sudah Dilaksanakan</h3>
                          <button onClick={() => handleMenuChange("ujian-online", 6)} className="text-sm font-medium text-blue-600 hover:text-blue-700 cursor-pointer">
                            Lihat Semua
                          </button>
                        </div>
                        <div className="space-y-4">
                          {examsList.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada ujian yang dilaksanakan.</p>
                          ) : (
                            examsList.map((exam: any, idx: number) => (
                              <div key={`stu-dash-exam-${exam.id || idx}-${idx}`} className="p-4 rounded-xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-colors cursor-pointer group">
                                <div>
                                  <h4 className="text-sm font-bold text-slate-900">{exam.title || "Ujian"}</h4>
                                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                                    <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {exam.date || "Tgl tidak tersedia"}</span>
                                  </div>
                                </div>
                                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
                              </div>
                            ))
                          )}
                        </div>
                        <button onClick={() => handleMenuChange("ujian-online", 6)} className="w-full py-3 bg-[#85cc00] hover:bg-[#74b300] text-white rounded-xl text-sm font-bold mt-6 transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer">
                          Lihat Semua Ujian <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Profil Siswa */}
              {activeMenu === "profil" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  {/* Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 mt-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-display font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent tracking-tight leading-tight">Profil Siswa</h2>
                      <p className="text-sm font-semibold text-slate-500 mt-1">Informasi lengkap mengenai data diri dan akademik Anda.</p>
                    </div>
                  </div>

                  {/* Main Card */}
                  <div className="bg-gradient-to-br from-white to-[#85cc00]/6 rounded-[2rem] border border-slate-200 p-8 shadow-sm flex flex-col md:flex-row gap-12 items-center md:items-start relative overflow-hidden">
                    {/* Photo & Basic Info */}
                    <div className="flex flex-col md:flex-row items-center md:items-start gap-8 flex-1 w-full">
                      <div className="relative shrink-0">
                        <div className="w-48 h-48 rounded-full overflow-hidden border-4 border-white shadow-xl bg-emerald-50">
                          {student?.profilePhotoUrl ? (
                            <img loading="lazy" 
                              src={getDriveImageUrl(student.profilePhotoUrl)} 
                              alt="Profile" 
                              className="w-full h-full object-cover" 
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full bg-[#e4e6eb] flex items-center justify-center">
                              <User className="w-[120%] h-[120%] text-[#aeb4bb] translate-y-2" fill="currentColor" />
                            </div>
                          )}
                        </div>
                        <button onClick={() => { setTempPhotoUrl(student?.profilePhotoUrl || ""); setIsProfileModalOpen(true); }} className="absolute bottom-4 right-2 w-10 h-10 bg-[#85cc00] text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white hover:bg-[#74b300] transition-colors cursor-pointer">
                          <Camera className="w-5 h-5" />
                        </button>
                      </div>
                      
                      <div className="flex flex-col flex-1 text-center md:text-left w-full pt-2">
                        <div className="flex flex-col md:flex-row items-center md:items-start gap-3 mb-1">
                          <h3 className="text-3xl font-bold text-slate-900">{student?.name || "Budi Santoso"}</h3>
                          <span className="px-3 py-1 bg-[#85cc00]/10 text-emerald-700 text-xs font-bold rounded-full border border-[#85cc00]/20">Siswa Aktif</span>
                        </div>
                        <p className="text-sm text-slate-500 mb-8">NIS : {student?.nis || "2023001234"}</p>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Calendar className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs text-slate-500 font-medium">Tanggal Lahir</span>
                              <span className="text-sm font-semibold text-slate-900 mt-0.5">12 Maret 2008</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Users className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs text-slate-500 font-medium">Kelas</span>
                              <span className="text-sm font-semibold text-slate-900 mt-0.5">{student?.class || "XI IPA 1"}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <User className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs text-slate-500 font-medium">Jenis Kelamin</span>
                              <span className="text-sm font-semibold text-slate-900 mt-0.5">Laki-laki</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Building2 className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs text-slate-500 font-medium">Sekolah</span>
                              <span className="text-sm font-semibold text-slate-900 mt-0.5">SMA Negeri 1 Bandung</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-400 shrink-0 border border-rose-100">
                              <Activity className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs text-slate-500 font-medium">Golongan Darah</span>
                              <span className="text-sm font-semibold text-slate-900 mt-0.5">O</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Calendar className="w-5 h-5" />
                            </div>
                            <div className="flex flex-col text-left">
                              <span className="text-xs text-slate-500 font-medium">Tahun Ajaran</span>
                              <span className="text-sm font-semibold text-slate-900 mt-0.5">2024 / 2025</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Quote Box */}
                    <div className="w-full md:w-72 shrink-0 bg-[#f4f7fb] rounded-3xl p-8 flex flex-col justify-center h-full min-h-[220px]">
                      <Quote className="w-8 h-8 text-blue-300 mb-6" />
                      <p className="text-sm font-medium text-slate-700 leading-relaxed mb-6">
                        Belajar hari ini, sukses esok hari.
                      </p>
                      <div className="font-['Dancing_Script',cursive] text-3xl text-blue-400 mt-auto opacity-80" style={{ fontFamily: "cursive" }}>
                        {student?.name || "Budi Santoso"}
                      </div>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex flex-nowrap overflow-x-auto items-center gap-2 border-b border-slate-200 mt-8 pb-px custom-scrollbar">
                    {["Data Pribadi", "Kontak & Alamat", "Orang Tua / Wali", "Riwayat Akademik", "Dokumen"].map((tab, tabIdx) => (
                      <button 
                        key={`prof-tab-${tab}-${tabIdx}`}
                        onClick={() => setActiveProfileTab(tab)}
                        className={`px-4 py-4 text-sm font-semibold transition-colors relative whitespace-nowrap cursor-pointer ${activeProfileTab === tab ? "text-blue-600" : "text-slate-500 hover:text-slate-700"}`}
                      >
                        <div className="flex items-center gap-2.5">
                          {tab === "Data Pribadi" && <User className="w-4.5 h-4.5" />}
                          {tab === "Kontak & Alamat" && <Phone className="w-4.5 h-4.5" />}
                          {tab === "Orang Tua / Wali" && <Users className="w-4.5 h-4.5" />}
                          {tab === "Riwayat Akademik" && <GraduationCap className="w-4.5 h-4.5" />}
                          {tab === "Dokumen" && <FileText className="w-4.5 h-4.5" />}
                          {tab}
                        </div>
                        {activeProfileTab === tab && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full"></div>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Tab Content */}
                  {activeProfileTab === "Data Pribadi" && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {/* Informasi Pribadi */}
                      <div className="bg-white rounded-[2rem] border border-slate-200 p-6 sm:p-8 flex flex-col h-full shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                          <h4 className="text-lg font-bold text-slate-900">Informasi Pribadi</h4>
                          {isEditingPribadi && (
                            <button 
                              onClick={() => setIsEditingPribadi(false)}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                            >
                              Batal
                            </button>
                          )}
                        </div>
                        <div className="space-y-0 flex-1">
                          <div className="flex items-center justify-between text-sm border-b border-slate-100 py-4 first:pt-0">
                            <div className="flex items-center gap-3 text-slate-500">
                              <User className="w-4 h-4" /> Nama Lengkap
                            </div>
                            {isEditingPribadi ? (
                              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="font-semibold text-slate-900 text-right bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-400 w-1/2" />
                            ) : (
                              <span className="font-semibold text-slate-900 text-right">{student?.name || "Budi Santoso"}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-sm border-b border-slate-100 py-4">
                            <div className="flex items-center gap-3 text-slate-500">
                              <FileText className="w-4 h-4" /> NIS
                            </div>
                            <span className="font-semibold text-slate-900 text-right">{student?.nis || "2023001234"}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm border-b border-slate-100 py-4">
                            <div className="flex items-center gap-3 text-slate-500">
                              <MapPin className="w-4 h-4" /> Tempat Lahir
                            </div>
                            {isEditingPribadi ? (
                              <input type="text" value={editTempatLahir} onChange={(e) => setEditTempatLahir(e.target.value)} placeholder="Contoh: Bandung" className="font-semibold text-slate-900 text-right bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-400 w-1/2" />
                            ) : (
                              <span className="font-semibold text-slate-900 text-right">{student?.tempatLahir || "Bandung"}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-sm border-b border-slate-100 py-4">
                            <div className="flex items-center gap-3 text-slate-500">
                              <Calendar className="w-4 h-4" /> Tanggal Lahir
                            </div>
                            {isEditingPribadi ? (
                              <input type="date" value={editTanggalLahir} onChange={(e) => setEditTanggalLahir(e.target.value)} className="font-semibold text-slate-900 text-right bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-400 w-1/2" />
                            ) : (
                              <span className="font-semibold text-slate-900 text-right">{student?.tanggalLahir || "12 Maret 2008"}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-sm border-b border-slate-100 py-4">
                            <div className="flex items-center gap-3 text-slate-500">
                              <Users className="w-4 h-4" /> Jenis Kelamin
                            </div>
                            {isEditingPribadi ? (
                              <select value={editJenisKelamin} onChange={(e) => setEditJenisKelamin(e.target.value)} className="font-semibold text-slate-900 text-right bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-400 w-1/2">
                                <option value="">Pilih...</option>
                                <option value="Laki-laki">Laki-laki</option>
                                <option value="Perempuan">Perempuan</option>
                              </select>
                            ) : (
                              <span className="font-semibold text-slate-900 text-right">{student?.jenisKelamin || "Laki-laki"}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-sm border-b border-slate-100 py-4">
                            <div className="flex items-center gap-3 text-slate-500">
                              <Moon className="w-4 h-4" /> Agama
                            </div>
                            {isEditingPribadi ? (
                              <input type="text" value={editAgama} onChange={(e) => setEditAgama(e.target.value)} placeholder="Contoh: Islam" className="font-semibold text-slate-900 text-right bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-400 w-1/2" />
                            ) : (
                              <span className="font-semibold text-slate-900 text-right">{student?.agama || "Islam"}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-sm py-4">
                            <div className="flex items-center gap-3 text-slate-500">
                              <Globe2 className="w-4 h-4" /> Kewarganegaraan
                            </div>
                            {isEditingPribadi ? (
                              <input type="text" value={editKewarganegaraan} onChange={(e) => setEditKewarganegaraan(e.target.value)} placeholder="Contoh: Indonesia" className="font-semibold text-slate-900 text-right bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-400 w-1/2" />
                            ) : (
                              <span className="font-semibold text-slate-900 text-right">{student?.kewarganegaraan || "Indonesia"}</span>
                            )}
                          </div>
                        </div>
                        {isEditingPribadi ? (
                          <button onClick={() => handleSaveProfileData("pribadi")} disabled={isSavingProfile} className="w-full py-3 mt-4 bg-blue-600 text-white font-semibold text-sm rounded-xl hover:bg-sky-600 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
                            {isSavingProfile ? "Menyimpan..." : "Simpan Perubahan"}
                          </button>
                        ) : (
                          <button onClick={() => setIsEditingPribadi(true)} className="w-full py-3 mt-4 text-blue-600 font-semibold text-sm rounded-xl border border-blue-100 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                            <Edit3 className="w-4 h-4" /> Edit Data Pribadi
                          </button>
                        )}
                      </div>

                      {/* Tentang Saya */}
                      <div className="bg-white rounded-[2rem] border border-slate-200 p-6 sm:p-8 flex flex-col h-full shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                          <h4 className="text-lg font-bold text-slate-900">Tentang Saya</h4>
                          {isEditingTentang && (
                            <button 
                              onClick={() => setIsEditingTentang(false)}
                              className="text-xs font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                            >
                              Batal
                            </button>
                          )}
                        </div>
                        <div className="space-y-6 flex-1">
                          <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Gamepad2 className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 mb-2 font-medium">Hobi <span className="text-slate-400 font-normal">(Pisahkan dengan koma)</span></p>
                              {isEditingTentang ? (
                                <input type="text" value={editHobi} onChange={(e) => setEditHobi(e.target.value)} placeholder="Membaca, Basket" className="font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded px-3 py-2 outline-none focus:border-sky-400 w-full" />
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {(student?.hobi || "Membaca, Basket").split(",").map((h: string, idx: number) => (
                                    <span key={`hobby-${idx}-${h.trim()}`} className="px-3 py-1 bg-slate-50 text-slate-700 text-xs rounded-full border border-slate-200 font-medium">{h.trim()}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Target className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 mb-1 font-medium">Cita-cita</p>
                              {isEditingTentang ? (
                                <input type="text" value={editCitaCita} onChange={(e) => setEditCitaCita(e.target.value)} placeholder="Contoh: Software Engineer" className="font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded px-3 py-2 outline-none focus:border-sky-400 w-full" />
                              ) : (
                                <span className="text-sm font-semibold text-slate-900">{student?.citaCita || "Software Engineer"}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <Lightbulb className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 mb-1 font-medium">Motto</p>
                              {isEditingTentang ? (
                                <textarea value={editMotto} onChange={(e) => setEditMotto(e.target.value)} rows={2} className="font-semibold text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded px-3 py-2 outline-none focus:border-sky-400 w-full resize-none"></textarea>
                              ) : (
                                <span className="text-sm font-medium text-slate-700 leading-relaxed block">{student?.motto || "Terus belajar dan jangan menyerah"}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0 border border-slate-100">
                              <AlignLeft className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-slate-500 mb-1 font-medium">Deskripsi</p>
                              {isEditingTentang ? (
                                <textarea value={editDeskripsi} onChange={(e) => setEditDeskripsi(e.target.value)} rows={3} className="font-semibold text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded px-3 py-2 outline-none focus:border-sky-400 w-full resize-none"></textarea>
                              ) : (
                                <span className="text-sm font-medium text-slate-700 leading-relaxed block">{student?.deskripsi || "Saya adalah siswa yang suka belajar hal baru dan berusaha memberikan yang terbaik."}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        {isEditingTentang ? (
                          <button onClick={() => handleSaveProfileData("tentang")} disabled={isSavingProfile} className="w-full py-3 mt-4 bg-blue-600 text-white font-semibold text-sm rounded-xl hover:bg-sky-600 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50">
                            {isSavingProfile ? "Menyimpan..." : "Simpan Perubahan"}
                          </button>
                        ) : (
                          <button onClick={() => setIsEditingTentang(true)} className="w-full py-3 mt-4 text-blue-600 font-semibold text-sm rounded-xl border border-blue-100 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 cursor-pointer">
                            <Edit3 className="w-4 h-4" /> Edit Tentang Saya
                          </button>
                        )}
                      </div>

                      {/* Statistik Singkat */}
                      <div className="bg-white rounded-[2rem] border border-slate-200 p-6 sm:p-8 flex flex-col h-full shadow-sm">
                        <h4 className="text-lg font-bold text-slate-900 mb-6">Statistik Singkat</h4>
                        <div className="space-y-4 flex-1">
                          <div className="p-4 rounded-2xl bg-white border border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                <BookOpen className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-slate-500">Kehadiran</p>
                                <p className="text-xl font-bold text-slate-900 mt-0.5">{attendanceSummary ? attendanceSummary.percentage : "92"}%</p>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-emerald-600">Baik</span>
                          </div>
                          
                          <div className="p-4 rounded-2xl bg-white border border-slate-100 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                                <Calendar className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-xs font-medium text-slate-500">Tugas Selesai</p>
                                <p className="text-xl font-bold text-slate-900 mt-0.5">18</p>
                              </div>
                            </div>
                            <span className="text-xs font-bold text-purple-600">Dari 20</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Alert Banner */}
                  <div className="bg-[#effef9] rounded-[2rem] p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6 justify-between mt-8 border border-[#c1ebd9]">
                    <div className="flex items-center gap-3 md:gap-6">
                      <div className="w-16 h-16 rounded-[24px] bg-gradient-to-br from-teal-100 to-emerald-200 text-emerald-600 flex items-center justify-center shrink-0 shadow-sm border border-white">
                        <ShieldCheck className="w-8 h-8" />
                      </div>
                      <div>
                        <h4 className="text-lg font-bold text-slate-900">Jaga data pribadimu dengan baik</h4>
                        <p className="text-sm font-medium text-slate-600 mt-1">Pastikan informasi yang kamu berikan benar dan selalu perbarui jika ada perubahan.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setActiveProfileTab("Data Pribadi");
                        setIsEditingPribadi(true);
                      }}
                      className="whitespace-nowrap px-6 py-3.5 bg-white text-emerald-600 border border-emerald-200 rounded-xl text-sm font-bold hover:bg-emerald-50 transition-colors shadow-sm flex items-center gap-2 cursor-pointer mt-4 sm:mt-0 w-full sm:w-auto justify-center"
                    >
                      <ShieldCheck className="w-4 h-4" /> Perbarui Data
                    </button>
                  </div>
                </div>
              )}

              {/* Tugas Siswa (Daftar Tugas) Menu */}
              {activeMenu === "daftar-tugas" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  {/* Title & Header Section */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 mt-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-display font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent tracking-tight leading-tight">Tugas Siswa</h2>
                      <p className="text-sm font-semibold text-slate-500 mt-1">
                        Kelola tugas untuk mata pelajaran {selectedSubject}.
                      </p>
                    </div>
                    
                  </div>

                  {/* Subject Overview Card & Stat Box Row */}
                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
                    {/* Left: Subject Info Card */}
                    <div className="xl:col-span-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex items-center gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 text-blue-600">
                        {(() => {
                          const IconComp = selectedSubject === "Informatika" ? MonitorPlay : 
                                           selectedSubject === "Matematika" ? BarChart3 : 
                                           selectedSubject === "Fisika" ? Lightbulb : BookOpen;
                          return <IconComp className="w-8 h-8" />;
                        })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-black text-slate-900 break-words whitespace-normal">{selectedSubject}</h3>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 font-bold break-words whitespace-normal">
                          Guru: Agan Parta, S.Kom.
                        </p>
                      </div>
                    </div>

                    {/* Right: 4 Stats Cards */}
                    <div className="xl:col-span-8 grid grid-cols-2 md:grid-cols-4 gap-4">
                      {/* Stat 1: Total */}
                      <button 
                        onClick={() => {
                          setTaskFilter("semua");
                          setVisibleTasksCount(5);
                        }}
                        className={`p-4 rounded-3xl bg-white border transition-all text-center flex flex-col items-center justify-center shadow-sm hover:border-blue-400 hover:shadow-md cursor-pointer ${taskFilter === "semua" ? "ring-2 ring-blue-500/20 border-sky-400" : "border-slate-200"}`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                            <FileText className="w-4.5 h-4.5" />
                          </div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Tugas</span>
                        </div>
                        <h4 className="text-3xl font-extrabold bg-gradient-to-r from-blue-600 via-indigo-500 to-sky-500 bg-clip-text text-transparent mt-3 leading-none">{totalTasksCount}</h4>
                      </button>

                      {/* Stat 2: Selesai */}
                      <button 
                        onClick={() => {
                          setTaskFilter("selesai");
                          setVisibleTasksCount(5);
                        }}
                        className={`p-4 rounded-3xl bg-white border transition-all text-center flex flex-col items-center justify-center shadow-sm hover:border-emerald-400 hover:shadow-md cursor-pointer ${taskFilter === "selesai" ? "ring-2 ring-emerald-500/20 border-emerald-500" : "border-slate-200"}`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                            <CheckCircle2 className="w-4.5 h-4.5" />
                          </div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selesai</span>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-3 leading-none">
                          <h4 className="text-3xl font-extrabold bg-gradient-to-r from-emerald-500 via-teal-500 to-green-500 bg-clip-text text-transparent">{selesaiTasksCount}</h4>
                          <span className="text-[9px] font-black text-white bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 rounded-md shadow-sm">
                            {selesaiPercentage}%
                          </span>
                        </div>
                      </button>

                      {/* Stat 3: Belum Dikerjakan */}
                      <button 
                        onClick={() => {
                          setTaskFilter("tertunda");
                          setVisibleTasksCount(5);
                        }}
                        className={`p-4 rounded-3xl bg-white border transition-all text-center flex flex-col items-center justify-center shadow-sm hover:border-amber-400 hover:shadow-md cursor-pointer ${taskFilter === "tertunda" ? "ring-2 ring-amber-500/20 border-amber-500" : "border-slate-200"}`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
                            <Hourglass className="w-4.5 h-4.5" />
                          </div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tertunda</span>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-3 leading-none">
                          <h4 className="text-3xl font-extrabold bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent">{belumDikerjakanTasksCount}</h4>
                          {totalTasksCount > 0 && (
                            <span className="text-[9px] font-black text-white bg-gradient-to-r from-amber-500 to-orange-500 px-1.5 py-0.5 rounded-md shadow-sm">
                              {belumDikerjakanPercentage}%
                            </span>
                          )}
                        </div>
                      </button>

                      {/* Stat 4: Terlambat */}
                      <button 
                        onClick={() => {
                          setTaskFilter("terlambat");
                          setVisibleTasksCount(5);
                        }}
                        className={`p-4 rounded-3xl bg-white border transition-all text-center flex flex-col items-center justify-center shadow-sm hover:border-rose-400 hover:shadow-md cursor-pointer ${taskFilter === "terlambat" ? "ring-2 ring-rose-500/20 border-rose-500" : "border-slate-200"}`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                            <Calendar className="w-4.5 h-4.5" />
                          </div>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Terlambat</span>
                        </div>
                        <div className="flex items-center justify-center gap-2 mt-3 leading-none">
                          <h4 className="text-3xl font-extrabold bg-gradient-to-r from-rose-500 via-red-500 to-pink-500 bg-clip-text text-transparent">{terlambatTasksCount}</h4>
                          {totalTasksCount > 0 && (
                            <span className="text-[9px] font-black text-white bg-gradient-to-r from-rose-500 to-red-500 px-1.5 py-0.5 rounded-md shadow-sm">
                              {terlambatPercentage}%
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Tabs, Search & Filter Bar */}
                  <div className="flex flex-col md:flex-row lg:items-center justify-between gap-4 mt-8 pb-3 border-b border-slate-200">
                    {/* Left: Tab selectors */}
                    <div className="flex flex-nowrap overflow-x-auto gap-2 pb-px custom-scrollbar">
                      {[
                        { id: "semua", label: "Semua" },
                        { id: "tertunda", label: "Belum Dikerjakan" },
                        { id: "selesai", label: "Dikumpulkan" },
                        { id: "terlambat", label: "Terlambat" }
                      ].map((tab, tabIdx) => {
                        const isActive = taskFilter === tab.id;
                        return (
                          <button
                            key={`task-filter-tab-${tab.id}-${tabIdx}`}
                            onClick={() => {
                              setTaskFilter(tab.id as any);
                              setVisibleTasksCount(5);
                            }}
                            className={`px-4 py-2.5 text-xs sm:text-sm font-bold rounded-xl whitespace-nowrap transition-all cursor-pointer ${
                              isActive 
                                ? "bg-blue-50 text-blue-600 border border-blue-100 shadow-sm" 
                                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {tab.id === "semua" && <FileText className="w-4 h-4" />}
                              {tab.id === "tertunda" && <Hourglass className="w-4 h-4" />}
                              {tab.id === "selesai" && <CheckCircle2 className="w-4 h-4" />}
                              {tab.id === "terlambat" && <Calendar className="w-4 h-4" />}
                              {tab.label}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Main Two-Column Bento Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                    {/* Left: Tasks List/Table Card */}
                    <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                      <h3 className="text-lg font-black text-slate-900 mb-6">Daftar Tugas {selectedSubject}</h3>
                      
                      {displayedTasks.length === 0 ? (
                        <div className="text-center py-16 text-slate-400 space-y-3">
                          <div className="w-16 h-16 rounded-3xl bg-slate-50 border border-slate-100 flex items-center justify-center mx-auto text-slate-300">
                            <FileText className="w-8 h-8" />
                          </div>
                          <p className="text-xs font-black uppercase tracking-widest">Tidak ada tugas ditemukan</p>
                          <p className="text-[10px] text-slate-400 max-w-xs mx-auto">Silakan pilih filter lain atau periksa kata kunci pencarian Anda.</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="border-b-2 border-slate-200">
                                  <th className="py-4 px-4 text-center w-12 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap rounded-tl-2xl">No</th>
                                  <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Nama Bab</th>
                                  <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Tugas Ke</th>
                                  <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Tanggal Terbit Tugas</th>
                                  <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Kirim Link Tugas</th>
                                  <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Tanggal Kirim Link</th>
                                  <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Instruksi Tugas</th>
                                  <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap rounded-tr-2xl">Nilai Akhir Tugas</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white">
                                {displayedTasks.slice(0, visibleTasksCount).map((task, idx) => {
                                  const isSubmitted = !!task.submission;
                                  const isCompleted = task.status === "selesai";
                                  const isLate = task.status === "terlambat";

                                  // Calculate "Tugas Ke" based on the order of this task in its Bab
                                  const babTasks = filteredTasksBySubject
                                    .filter(t => t.bab === task.bab)
                                    .sort((a, b) => new Date(a.publishedAt || "").getTime() - new Date(b.publishedAt || "").getTime());
                                  const sequentialNo = babTasks.findIndex(t => t.id === task.id) + 1;

                                  // Format Dates nicely
                                  const publishedDate = task.publishedAt ? (
                                    typeof task.publishedAt === "string" && task.publishedAt.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(task.publishedAt) ?
                                      (() => {
                                        const p = task.publishedAt.split("-");
                                        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
                                      })() :
                                      new Date(task.publishedAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
                                  ) : "-";

                                  const submittedDate = task.submission?.submittedAt ? new Date(task.submission.submittedAt).toLocaleDateString("id-ID", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric"
                                  }) + " " + new Date(task.submission.submittedAt).toLocaleTimeString("id-ID", {
                                    hour: "2-digit",
                                    minute: "2-digit"
                                  }) + " WIB" : "-";

                                  return (
                                    <tr key={`task-${task.id || idx}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                      {/* 1. No */}
                                      <td className="py-4 px-4 text-center font-black text-slate-400 whitespace-nowrap">
                                        {idx + 1}
                                      </td>

                                      {/* 2. Nama Bab */}
                                      <td className="py-4 px-4 font-bold text-slate-900 leading-normal whitespace-nowrap">
                                        {task.bab}
                                      </td>

                                      {/* 3. Tugas Ke */}
                                      <td className="py-4 px-4 whitespace-nowrap">
                                        <div className="flex flex-col gap-0.5">
                                          <span className="font-bold text-slate-800">
                                            Tugas {sequentialNo}
                                          </span>
                                          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest line-clamp-1" title={task.title}>
                                            {task.title}
                                          </span>
                                        </div>
                                      </td>

                                      {/* 4. Tanggal Terbit Tugas */}
                                      <td className="py-4 px-4 text-center font-bold text-slate-600 whitespace-nowrap">
                                        {publishedDate}
                                      </td>

                                      {/* 5. Kirim Link Tugas */}
                                      <td className="py-4 px-4 text-center whitespace-nowrap">
                                        {task.submission?.status === "ditolak" ? (
                                          <button 
                                            onClick={() => setViewingTugas(task)}
                                            className="px-4 py-2 bg-rose-50 text-rose-600 font-black uppercase tracking-widest text-[10px] rounded-lg transition-all hover:bg-rose-100 border border-rose-200 cursor-pointer shadow-sm"
                                          >
                                            Lihat Alasan ❌
                                          </button>
                                        ) : isSubmitted ? (
                                          <button 
                                            onClick={() => setViewingTugas(task)}
                                            className="px-4 py-2 bg-blue-50 text-blue-600 font-black uppercase tracking-widest text-[10px] rounded-lg transition-all hover:bg-blue-100 border border-blue-200 cursor-pointer shadow-sm"
                                          >
                                            Lihat Hasil
                                          </button>
                                        ) : (
                                          <button 
                                            onClick={() => {
                                              setSelectedTugas(task);
                                              setSelectedFile("");
                                              setIsUploadModalOpen(true);
                                            }}
                                            className="px-4 py-2 bg-slate-900 text-white hover:bg-[#85cc00] hover:text-slate-900 font-black uppercase tracking-widest text-[10px] rounded-lg transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-2 mx-auto"
                                          >
                                            Kumpulkan <ArrowRight className="w-3 h-3" />
                                          </button>
                                        )}
                                      </td>

                                      {/* 6. Tanggal Kirim Link */}
                                      <td className="py-4 px-4 text-center font-bold text-slate-600 whitespace-nowrap">
                                        {submittedDate}
                                      </td>

                                      {/* 7. Lihat Tugas */}
                                      <td className="py-4 px-4 text-center whitespace-nowrap">
                                        {(() => {
                                          const rawLink = task.taskLink || task.linkTugas || task.fileUrl || task.driveUrl;
                                          if (!rawLink) {
                                            return (
                                              <span className="text-[11px] font-semibold text-slate-400 bg-slate-50 px-2.5 py-1 rounded border border-slate-100">
                                                -
                                              </span>
                                            );
                                          }

                                          const hrefUrl = rawLink.startsWith("http://") || rawLink.startsWith("https://")
                                            ? rawLink
                                            : `https://${rawLink}`;

                                          return (
                                            <a
                                              href={hrefUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => handleOpenFileLink(rawLink, e)}
                                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-extrabold text-xs rounded-lg transition-all shadow-2xs hover:scale-105 active:scale-95 cursor-pointer"
                                              title="Buka file / link tugas dari guru (PDF, Word, YouTube, Drive)"
                                            >
                                              <ExternalLink className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                              <span>Lihat Tugas</span>
                                            </a>
                                          );
                                        })()}
                                      </td>

                                      {/* 8. Nilai Akhir Tugas */}
                                      <td className="py-4 px-4 text-center whitespace-nowrap">
                                        {task.submission?.status === "ditolak" ? (
                                          <span className="inline-flex items-center px-2 py-1 text-[9px] font-black uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-100 rounded">
                                            Ditolak ❌
                                          </span>
                                        ) : task.submission?.nilai ? (
                                          <span className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                                            {task.submission.nilai} ✓
                                          </span>
                                        ) : isSubmitted ? (
                                          <span className="inline-flex items-center px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-100 rounded">
                                            Menunggu Penilaian ⌛
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center px-2 py-1 text-[9px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-100 rounded">
                                            (Segera Kerjakan) 📝
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* "Muat Lebih Banyak" / Collapse Button */}
                          {displayedTasks.length > 5 && (
                            <div className="pt-4 border-t border-slate-100 flex justify-center">
                              <button
                                onClick={() => {
                                  if (visibleTasksCount >= displayedTasks.length) {
                                    setVisibleTasksCount(5);
                                  } else {
                                    setVisibleTasksCount(displayedTasks.length);
                                  }
                                }}
                                className="px-6 py-2.5 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-black tracking-wide uppercase transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                              >
                                {visibleTasksCount >= displayedTasks.length ? (
                                  <>
                                    Sembunyikan <ChevronUp className="w-4 h-4 text-slate-400" />
                                  </>
                                ) : (
                                  <>
                                    Muat Lebih Banyak <ChevronDown className="w-4 h-4 text-slate-400" />
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                      {/* Right: Summary Column */}
                    <div className="space-y-6">
                      {/* Troubleshooting Guide */}
                      <div className="bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-xl overflow-hidden relative group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                          <AlertTriangle className="w-24 h-24 text-white" />
                        </div>
                        
                        <div className="relative z-10">
                          <h4 className="text-white font-black text-sm uppercase tracking-widest flex items-center gap-2 mb-4">
                            <ShieldAlert className="w-4 h-4 text-amber-400" />
                            Panduan & Status Tugas
                          </h4>
                          
                          <div className="space-y-4">
                            {/* Status Penilaian */}
                            <div className="bg-slate-800/50 p-4 rounded-2xl border border-white/5 hover:border-emerald-400/30 transition-all">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 bg-emerald-400 text-slate-900 text-[10px] font-black rounded uppercase">Status</span>
                                <span className="text-emerald-400 text-[11px] font-bold uppercase tracking-tight">Penilaian</span>
                              </div>
                              <ul className="text-[10px] text-slate-300 space-y-1.5 list-disc pl-3">
                                <li><strong>Menunggu Penilaian Guru:</strong> Tugas sudah masuk & sedang diperiksa.</li>
                                <li><strong>Sudah Dinilai:</strong> Hasil final. Tugas <span className="text-amber-400">TIDAK BISA</span> dikirim ulang jika sudah muncul nilai.</li>
                              </ul>
                            </div>

                            {/* Google Drive Link Rules */}
                            <div className="bg-slate-800/50 p-4 rounded-2xl border border-white/5 hover:border-[#85cc00]/30 transition-all">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="px-2 py-0.5 bg-[#85cc00] text-slate-900 text-[10px] font-black rounded uppercase">Google Drive</span>
                                <span className="text-[#85cc00] text-[11px] font-bold uppercase tracking-tight">Aturan Link Tautan</span>
                              </div>
                              <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                                Tugas kini wajib dikumpulkan menggunakan <strong>Link / Tautan Google Drive</strong> pribadi Anda dengan mengikuti ketentuan berikut:
                              </p>
                              <ul className="text-[10px] text-slate-300 space-y-2 list-disc pl-3">
                                <li><strong>Akses Berbagi (PENTING):</strong> Atur izin berbagi file di Google Drive Anda menjadi <span className="text-amber-400 font-bold">"Siapa saja yang memiliki link dapat melihat"</span> (Anyone with the link can view).</li>
                                <li><strong>Validasi Link:</strong> Pastikan tautan yang ditempelkan valid (dimulai dengan https://) dan mengarah langsung ke file tugas Anda.</li>
                                <li><strong>Jangan Hapus File:</strong> Jangan menghapus atau memindahkan file di Google Drive Anda sebelum Guru selesai memberikan penilaian.</li>
                              </ul>
                            </div>

                            {/* Umum */}
                            <div className="bg-slate-800/50 p-4 rounded-2xl border border-white/5">
                              <p className="text-[10px] text-slate-400 italic">
                                *Izin akses Google Drive yang dikunci akan menyebabkan tugas Anda tidak dapat dinilai oleh Guru. Mohon teliti sebelum mengumpulkan.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Doughnut Summary Chart */}
                      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col items-center">
                        <div className="w-full text-left mb-6">
                          <h4 className="font-black text-slate-900 tracking-tight">Ringkasan {selectedSubject}</h4>
                        </div>
                        
                        {totalTasksCount > 0 ? (
                          <div className="flex flex-col sm:flex-row xl:flex-col items-center gap-6 w-full justify-around xl:justify-center">
                            {/* Doughnut SVG Container */}
                            <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
                              <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                                <circle cx="50" cy="50" r="38" fill="transparent" stroke="#f8fafc" strokeWidth="12" />
                                
                                {/* Selesai (emerald) */}
                                <circle 
                                  cx="50" cy="50" r="38" 
                                  fill="transparent" 
                                  stroke="#10b981" 
                                  strokeWidth="12" 
                                  strokeDasharray="238.76"
                                  strokeDashoffset={238.76 - (238.76 * selesaiTasksCount) / totalTasksCount}
                                  strokeLinecap="round"
                                  className="transition-all duration-1000 ease-out"
                                />
                                
                                {/* Belum Dikerjakan (amber) */}
                                <circle 
                                  cx="50" cy="50" r="38" 
                                  fill="transparent" 
                                  stroke="#f59e0b" 
                                  strokeWidth="12" 
                                  strokeDasharray="238.76"
                                  strokeDashoffset={238.76 - (238.76 * belumDikerjakanTasksCount) / totalTasksCount}
                                  transform={`rotate(${(360 * selesaiTasksCount) / totalTasksCount} 50 50)`}
                                  strokeLinecap="round"
                                  className="transition-all duration-1000 ease-out"
                                />

                                {/* Terlambat (rose) */}
                                <circle 
                                  cx="50" cy="50" r="38" 
                                  fill="transparent" 
                                  stroke="#ef4444" 
                                  strokeWidth="12" 
                                  strokeDasharray="238.76"
                                  strokeDashoffset={238.76 - (238.76 * terlambatTasksCount) / totalTasksCount}
                                  transform={`rotate(${(360 * (selesaiTasksCount + belumDikerjakanTasksCount)) / totalTasksCount} 50 50)`}
                                  strokeLinecap="round"
                                  className="transition-all duration-1000 ease-out"
                                />
                              </svg>
                              <div className="absolute inset-0 flex flex-col items-center justify-center">
                                <span className="text-3xl font-black bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 bg-clip-text text-transparent tracking-tight">{totalTasksCount}</span>
                                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Total Tugas</span>
                              </div>
                            </div>

                            {/* Legend Details */}
                            <div className="space-y-2.5 w-full max-w-[200px]">
                              <div className="flex justify-between items-center text-xs">
                                <span className="flex items-center gap-2 text-slate-600 font-bold">
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20"></span> 
                                  Selesai
                                </span>
                                <span className="font-extrabold text-emerald-600">{selesaiTasksCount} ({selesaiPercentage}%)</span>
                              </div>
                              <div className="flex justify-between items-center text-xs">
                                <span className="flex items-center gap-2 text-slate-600 font-bold">
                                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/20"></span> 
                                  Tertunda
                                </span>
                                <span className="font-extrabold text-amber-500">{belumDikerjakanTasksCount} ({belumDikerjakanPercentage}%)</span>
                              </div>
                              <div className="flex justify-between items-center text-xs">
                                <span className="flex items-center gap-2 text-slate-600 font-bold">
                                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/20"></span> 
                                  Terlambat
                                </span>
                                <span className="font-extrabold text-rose-500">{terlambatTasksCount} ({terlambatPercentage}%)</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-6 text-slate-400 text-xs font-bold">Belum ada statistik tugas.</div>
                        )}
                      </div>

                      {/* Deadline Terdekat Card */}
                      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="font-black text-slate-900 tracking-tight">Deadline Terdekat</h4>
                          <button 
                            onClick={() => {
                              setTaskFilter("tertunda");
                              setVisibleTasksCount(5);
                            }}
                            className="text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                          >
                            Lihat Semua
                          </button>
                        </div>
                        
                        {(() => {
                          const closestTask = filteredTasksBySubject
                            .filter(t => t.status !== "selesai")
                            .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())[0];
                          
                          if (!closestTask) {
                            return (
                              <div className="p-4 bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-2xl text-center text-xs font-bold">
                                Semua tugas telah selesai! 🎉
                              </div>
                            );
                          }
                          
                          return (
                            <div className="p-4 bg-slate-50/50 border border-slate-100 rounded-2xl flex items-center gap-4 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer"
                              onClick={() => {
                                setSelectedTugas(closestTask);
                                setSelectedFile("");
                                setIsUploadModalOpen(true);
                              }}
                            >
                              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0 border border-blue-100">
                                <Clock className="w-5 h-5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h5 className="text-xs font-bold text-slate-900 truncate">{closestTask.title}</h5>
                                <p className="text-[10px] text-slate-500 mt-1 font-bold">
                                  {new Date(closestTask.deadline).toLocaleDateString("id-ID", {
                                    day: "numeric",
                                    month: "long",
                                    year: "numeric"
                                  })} | {new Date(closestTask.deadline).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB
                                </p>
                              </div>
                              <div className="shrink-0">
                                {closestTask.status === "terlambat" ? (
                                  <span className="px-2 py-0.5 bg-rose-50 border border-rose-100 text-rose-600 text-[9px] font-black rounded-md">Terlambat</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-amber-50 border border-amber-100 text-amber-600 text-[9px] font-black rounded-md">Mendekati</span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Tips Card */}
                      <div className="bg-[#f0f9ff] border border-blue-100 p-6 rounded-3xl shadow-sm relative overflow-hidden">
                        <div className="relative z-10 space-y-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-500 text-white flex items-center justify-center shadow-sm border border-blue-400/30">
                            <Lightbulb className="w-5 h-5" />
                          </div>
                          <h4 className="font-bold text-slate-900 text-sm">Tips Belajar</h4>
                          <p className="text-xs font-bold text-slate-600 leading-relaxed">
                            Pelajari setiap Bab secara mendalam melalui Materi Pembelajaran sebelum menempuh Ujian CBT agar siap dengan soal-soal standar Kurikulum Merdeka. Sesuai dengan keadaan sistem terbaru pada saat ini.
                          </p>
                        </div>
                        {/* Dot Pattern Graphic */}
                        <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none translate-x-4 translate-y-4">
                          <div className="grid grid-cols-4 gap-2">
                            {Array.from({ length: 16 }).map((_, i) => (
                              <div key={`dot-graphic-${i}`} className="w-2 h-2 rounded-full bg-blue-500"></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Banner */}
                  <div className="bg-gradient-to-r from-slate-50 to-slate-100 border border-slate-200 rounded-[2rem] p-6 flex flex-col sm:flex-row items-center justify-between gap-6 mt-8 shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 border border-blue-200">
                        <Calendar className="w-6 h-6 animate-pulse" />
                      </div>
                      <div>
                        <h4 className="text-base font-black text-slate-900">Disiplin adalah kunci keberhasilan</h4>
                        <p className="text-xs font-bold text-slate-500 mt-1">Kerjakan tugas tepat waktu dan jangan lupa periksa kembali sebelum mengumpulkan.</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setCurrentTipIdx(0);
                        setIsGuideModalOpen(true);
                      }}
                      className="px-6 py-3 bg-blue-600 hover:bg-sky-600 text-white rounded-xl text-xs font-extrabold shadow-md shadow-blue-500/20 hover:shadow-blue-500/30 transition-all flex items-center gap-2 cursor-pointer w-full sm:w-auto justify-center shrink-0 border border-transparent"
                    >
                      <span>Lihat Panduan Tugas</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Nilai Siswa Menu */}
              {activeMenu === "nilai-siswa" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mt-4 mb-6 gap-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-display font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent tracking-tight leading-tight">Nilai Siswa</h2>
                      <p className="text-sm font-semibold text-slate-500 mt-1">Kumpulan nilai dari setiap tugas yang telah Anda kerjakan.</p>
                    </div>
                  </div>
                  
                  {/* Filters & Controls */}

                  {/* Table & Stats Content Section */}
                  <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
                      <div className="flex items-center border-b border-slate-100 bg-slate-50/50 px-8 py-6 relative gap-4">
                        <div className="w-1.5 h-8 bg-[#85cc00] rounded-full"></div>
                        <div>
                          <span className="font-black text-slate-900 text-base tracking-widest uppercase block">Rubrik & Kalkulasi Nilai Rapor Akhir</span>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">Informasi bobot penilaian & kalkulasi skor Anda secara real-time.</p>
                        </div>
                      </div>
                      <div className="p-6 md:p-8 space-y-8">
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-stretch">
                          {/* Rubrik Cards - 2 Columns x 2 Rows */}
                          <div className="md:col-span-7 grid grid-cols-2 gap-4">
                             <div className="p-5 rounded-3xl border border-emerald-100 bg-emerald-50/50 flex flex-col justify-between group hover:bg-white hover:shadow-lg transition-all duration-300">
                               <div>
                                 <div className="flex justify-between items-start mb-2">
                                   <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Kehadiran ({rubric.kehadiran}%)</span>
                                   <Users className="w-4 h-4 text-emerald-500 opacity-40" />
                                 </div>
                                 <div className="flex items-baseline gap-1">
                                   <span className="text-3xl font-display font-black text-emerald-600">{reportCardGrade?.nilaiKehadiran || 0}</span>
                                   <span className="text-xs font-bold text-emerald-400">/ 100</span>
                                 </div>
                                 <p className="text-[10px] text-slate-400 mt-2 font-medium">Presensi: {reportCardGrade?.hadirCount || 0} dari {reportCardGrade?.totalMeetings || 0}</p>
                               </div>
                             </div>

                             <div className="p-5 rounded-3xl border border-blue-100 bg-blue-50/50 flex flex-col justify-between group hover:bg-white hover:shadow-lg transition-all duration-300">
                               <div>
                                 <div className="flex justify-between items-start mb-2">
                                   <span className="text-[10px] font-black uppercase tracking-widest text-blue-700">Tugas ({rubric.tugas}%)</span>
                                   <BookOpen className="w-4 h-4 text-blue-500 opacity-40" />
                                 </div>
                                 <div className="flex items-baseline gap-1">
                                   <span className="text-3xl font-display font-black text-blue-600">{reportCardGrade?.avgTugas || 0}</span>
                                   <span className="text-xs font-bold text-blue-400">/ 100</span>
                                 </div>
                                 <p className="text-[10px] text-slate-400 mt-2 font-medium">Rata-rata Tugas & Ujian Harian.</p>
                               </div>
                             </div>

                             <div className="p-5 rounded-3xl border border-amber-100 bg-amber-50/50 flex flex-col justify-between group hover:bg-white hover:shadow-lg transition-all duration-300">
                               <div>
                                 <div className="flex justify-between items-start mb-2">
                                   <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">UTS ({rubric.uts}%)</span>
                                   <Star className="w-4 h-4 text-amber-500 opacity-40" />
                                 </div>
                                 <div className="flex items-baseline gap-1">
                                   <span className="text-3xl font-display font-black text-amber-600">{reportCardGrade?.nilaiUts || 0}</span>
                                   <span className="text-xs font-bold text-amber-400">/ 100</span>
                                 </div>
                                 <p className="text-[10px] text-slate-400 mt-2 font-medium">Penilaian Tengah Semester.</p>
                               </div>
                             </div>

                             <div className="p-5 rounded-3xl border border-rose-100 bg-rose-50/50 flex flex-col justify-between group hover:bg-white hover:shadow-lg transition-all duration-300">
                               <div>
                                 <div className="flex justify-between items-start mb-2">
                                   <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">UAS ({rubric.uas}%)</span>
                                   <Award className="w-4 h-4 text-rose-500 opacity-40" />
                                 </div>
                                 <div className="flex items-baseline gap-1">
                                   <span className="text-3xl font-display font-black text-rose-600">{reportCardGrade?.nilaiUas || 0}</span>
                                   <span className="text-xs font-bold text-rose-400">/ 100</span>
                                 </div>
                                 <p className="text-[10px] text-slate-400 mt-2 font-medium">Sumatif Akhir Semester.</p>
                               </div>
                             </div>
                          </div>

                          {/* Nilai Akhir Display - Right Column */}
                          <div className="md:col-span-5 flex flex-col h-full">
                            <div className="bg-gradient-to-br from-[#85cc00] to-[#74b300] rounded-[2rem] p-8 text-slate-950 flex flex-col items-center justify-center gap-6 relative overflow-hidden shadow-2xl shadow-[#85cc00]/20 flex-1 min-h-[300px]">
                              {/* Decorative Elements */}
                              <div className="absolute top-0 right-0 w-64 h-64 bg-white/20 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2"></div>
                              
                              <div className="w-24 h-24 md:w-28 md:h-28 rounded-[2.5rem] bg-white flex flex-col items-center justify-center text-slate-950 shadow-2xl z-10 scale-110">
                                <span className="text-[10px] font-black uppercase tracking-tighter leading-none mb-1 opacity-60">SKOR AKHIR</span>
                                <span className="text-4xl md:text-5xl font-display font-black leading-none">{reportCardGrade?.finalScore || 0}</span>
                              </div>

                              <div className="text-center z-10 flex flex-col items-center">
                                <h4 className="text-lg md:text-xl font-black tracking-tight leading-tight uppercase">ESTIMASI NILAI RAPOR</h4>
                                <p className="text-[10px] text-slate-900/60 font-black mt-1 uppercase tracking-[0.2em] flex items-center justify-center gap-2">
                                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                  REAL-TIME CALCULATION
                                </p>
                                <p className="text-[11px] text-slate-900/80 font-medium bg-white/40 backdrop-blur-md px-3.5 py-1.5 rounded-xl mt-2 max-w-[280px] text-center leading-snug border border-white/30">
                                  *Catatan: Nilai ini merupakan estimasi sementara sebelum seluruh tugas dan ujian selesai dilaksanakan.
                                </p>
                              </div>

                              <div className="flex flex-col items-center gap-3 z-10 w-full max-w-[280px]">
                                 {(() => {
                                   const score = reportCardGrade?.finalScore || 0;
                                   let label = "DI BAWAH KKM";
                                   let color = "text-rose-700";
                                   let bg = "bg-white/90";
                                   let border = "border-rose-200";
                                   
                                   if (score >= 92) {
                                     label = "SANGAT BAIK (A)";
                                     color = "text-emerald-700";
                                     border = "border-emerald-200";
                                   } else if (score >= 84) {
                                     label = "BAIK (B)";
                                     color = "text-blue-700";
                                     border = "border-blue-200";
                                   } else if (score >= 75) {
                                     label = "CUKUP / TUNTAS (C)";
                                     color = "text-slate-800";
                                     border = "border-slate-200";
                                   }
                                   
                                   return (
                                     <>
                                       <div className={`px-6 py-4 rounded-2xl border-2 ${bg} ${border} ${color} font-black text-sm tracking-[0.2em] whitespace-nowrap flex items-center justify-center text-center w-full shadow-sm`}>
                                         {label}
                                       </div>
                                       <p className="text-[10px] text-slate-900/40 font-bold uppercase tracking-widest text-center">KKM STANDAR: 75</p>
                                     </>
                                   );
                                 })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex border-b border-t border-slate-100 bg-slate-50/50 justify-center items-center px-8 py-5 relative">
                        <span className="font-extrabold text-slate-800 text-sm tracking-wider uppercase text-center">Rekapitulasi Nilai Tugas & Ujian</span>
                        <div className="absolute right-8 hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-400 bg-slate-100/80 px-3 py-1.5 rounded-xl">
                          <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                          <span>Informatika</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto p-4 sm:p-6 custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b-2 border-slate-200">
                                    <th className="py-4 px-4 text-center w-12 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap rounded-tl-2xl">No</th>
                                    <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Nama Bab</th>
                                    <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Tugas Ke</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Tanggal Pengumpulan Tugas</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Nilai Tugas</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap rounded-tr-2xl">Predikat Nilai</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white">
                                {combinedGrades.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="py-12 px-6 text-center text-slate-400 font-medium border-b border-slate-100">
                                      <div className="flex flex-col items-center justify-center gap-2">
                                        <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
                                          <Award className="w-6 h-6" />
                                        </div>
                                        <span>Belum ada nilai yang terdata.</span>
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
                                  combinedGrades.map((g, idx) => {
                                    const score = g.nilai;
                                    const isExcellent = score >= 92;
                                    const isGood = score >= 84 && score < 92;
                                    const isPassing = score >= 75 && score < 84;
                                    
                                    const scoreBg = isExcellent
                                      ? "bg-emerald-50 text-emerald-700 font-black px-2.5 py-1 rounded border border-emerald-200 inline-block min-w-[45px] text-center"
                                      : isGood
                                      ? "bg-blue-50 text-blue-700 font-black px-2.5 py-1 rounded border border-blue-200 inline-block min-w-[45px] text-center"
                                      : isPassing
                                      ? "bg-amber-50 text-amber-700 font-black px-2.5 py-1 rounded border border-amber-200 inline-block min-w-[45px] text-center"
                                      : "bg-rose-50 text-rose-700 font-black px-2.5 py-1 rounded border border-rose-200 inline-block min-w-[45px] text-center";

                                    let predikatLabel = "Kurang (D)";
                                    let predikatBg = "bg-rose-50 text-rose-700 border border-rose-200";
                                    if (score >= 92) {
                                      predikatLabel = "Sangat Baik (A)";
                                      predikatBg = "bg-emerald-50 text-emerald-700 border border-emerald-200";
                                    } else if (score >= 84) {
                                      predikatLabel = "Baik (B)";
                                      predikatBg = "bg-blue-50 text-blue-700 border border-blue-200";
                                    } else if (score >= 75) {
                                      predikatLabel = "Cukup (C)";
                                      predikatBg = "bg-amber-50 text-amber-700 border border-amber-200";
                                    }

                                    // Calculate sequential "Tugas Ke" or label if "Ujian"
                                    let sequentialText = "-";
                                    if (g.type === "Tugas") {
                                      const babTasks = assignmentsList
                                        .filter((a: any) => (a.bab || "Informatika") === g.bab)
                                        .sort((a: any, b: any) => new Date(a.publishedAt || a.createdAt || "").getTime() - new Date(b.publishedAt || b.createdAt || "").getTime());
                                      const seqNo = babTasks.findIndex((a: any) => a.id === g.id) + 1;
                                      sequentialText = seqNo > 0 ? `Tugas ${seqNo}` : "Tugas -";
                                    } else {
                                      sequentialText = "Ujian CBT";
                                    }

                                    return (
                                      <tr key={`grade-${g.type}-${g.id || idx}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        {/* 1. No */}
                                        <td className="py-4 px-4 text-center font-black text-slate-400 whitespace-nowrap">
                                          {idx + 1}
                                        </td>

                                        {/* 2. Nama Bab */}
                                        <td className="py-4 px-4 font-bold text-slate-900 leading-normal whitespace-nowrap">
                                          {g.bab || "Informatika"}
                                        </td>

                                        {/* 3. Tugas Ke */}
                                        <td className="py-4 px-4 whitespace-nowrap">
                                          <div className="flex flex-col gap-0.5">
                                            <span className={`font-bold ${g.type === 'Ujian' ? 'text-purple-700' : 'text-slate-800'}`}>
                                              {sequentialText}
                                            </span>
                                            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-widest line-clamp-1" title={g.title}>
                                              {g.title}
                                            </span>
                                          </div>
                                        </td>

                                        {/* 4. Tanggal Pengumpulan Tugas */}
                                        <td className="py-4 px-4 text-center font-bold text-slate-600 whitespace-nowrap">
                                          {g.tanggal}
                                        </td>

                                        {/* 5. Nilai Tugas */}
                                        <td className="py-4 px-4 text-center whitespace-nowrap">
                                          <span className={scoreBg}>
                                            {g.nilai}
                                          </span>
                                        </td>

                                        {/* 6. Predikat Nilai */}
                                        <td className="py-4 px-4 text-center whitespace-nowrap">
                                          <span className={`inline-flex items-center px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded ${predikatBg}`}>
                                            {predikatLabel}
                                          </span>
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                            </tbody>
                        </table>
                      </div>
                      

                  </div>

                  {/* Rubrik Penilaian Predikat */}
                  <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
                      <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">Rubrik Penilaian Predikat</h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex flex-col items-center text-center gap-2">
                        <span className="text-2xl font-black text-emerald-600">A</span>
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black uppercase text-emerald-700 tracking-tight">Rentang Nilai</p>
                          <p className="text-xs font-bold text-slate-600">92 - 100</p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-500 text-white text-[9px] font-black rounded-lg uppercase">Sangat Baik</span>
                      </div>
                      <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex flex-col items-center text-center gap-2">
                        <span className="text-2xl font-black text-blue-600">B</span>
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black uppercase text-blue-700 tracking-tight">Rentang Nilai</p>
                          <p className="text-xs font-bold text-slate-600">84 - 91</p>
                        </div>
                        <span className="px-3 py-1 bg-blue-500 text-white text-[9px] font-black rounded-lg uppercase">Baik</span>
                      </div>
                      <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex flex-col items-center text-center gap-2">
                        <span className="text-2xl font-black text-amber-600">C</span>
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black uppercase text-amber-700 tracking-tight">Rentang Nilai</p>
                          <p className="text-xs font-bold text-slate-600">75 - 83</p>
                        </div>
                        <span className="px-3 py-1 bg-amber-500 text-white text-[9px] font-black rounded-lg uppercase">Cukup</span>
                      </div>
                      <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex flex-col items-center text-center gap-2">
                        <span className="text-2xl font-black text-rose-600">D</span>
                        <div className="space-y-0.5">
                          <p className="text-[10px] font-black uppercase text-rose-700 tracking-tight">Rentang Nilai</p>
                          <p className="text-xs font-bold text-slate-600">{'<'} 75</p>
                        </div>
                        <span className="px-3 py-1 bg-rose-500 text-white text-[9px] font-black rounded-lg uppercase">Kurang</span>
                      </div>
                    </div>
                  </div>

                  {/* Summary Bento Stats */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-5 hover:border-emerald-200 transition-all group">
                         <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100 group-hover:scale-110 transition-transform">
                            <Sparkles className="w-7 h-7" />
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nilai Tertinggi</p>
                            <p className="text-2xl font-extrabold bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 bg-clip-text text-transparent mt-1 leading-none pb-0.5">
                              {nilaiTertinggi > 0 ? nilaiTertinggi.toFixed(1) : "0"}
                            </p>
                            <p className="text-[9px] font-bold text-slate-500 mt-1 line-clamp-2 break-words whitespace-normal leading-tight" title={highestGradeTitle}>
                              {highestGradeTitle}
                            </p>
                         </div>
                      </div>

                      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-5 hover:border-amber-200 transition-all group">
                         <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100 group-hover:scale-110 transition-transform">
                            <TrendingUp className="w-7 h-7" />
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nilai Terendah</p>
                            <p className="text-2xl font-extrabold bg-gradient-to-r from-rose-500 via-orange-500 to-yellow-500 bg-clip-text text-transparent mt-1 leading-none pb-0.5">
                              {nilaiTerendah > 0 ? nilaiTerendah.toFixed(1) : "0"}
                            </p>
                            <p className="text-[9px] font-bold text-slate-500 mt-1 line-clamp-2 break-words whitespace-normal leading-tight" title={lowestGradeTitle}>
                              {lowestGradeTitle}
                            </p>
                         </div>
                      </div>

                      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center gap-5 hover:border-purple-200 transition-all group">
                         <div className="w-14 h-14 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 border border-purple-100 group-hover:scale-110 transition-transform">
                            <ClipboardList className="w-7 h-7" />
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Tugas</p>
                            <p className="text-2xl font-extrabold bg-gradient-to-r from-purple-600 via-fuchsia-500 to-pink-500 bg-clip-text text-transparent mt-1 leading-none pb-0.5">{combinedGrades.length}</p>
                            <p className="text-[9px] font-bold text-slate-500 mt-1 line-clamp-2 break-words whitespace-normal leading-tight">
                              {combinedGrades.length > 0 ? "Tugas & Ujian" : "Belum ada nilai"}
                            </p>
                         </div>
                      </div>
                  </div>
                </div>
              )}

              {/* Kehadiran Menu */}
              {activeMenu === "kehadiran" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mt-4 mb-6 gap-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-display font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent tracking-tight leading-tight">Kehadiran Siswa</h2>
                      <p className="text-sm font-semibold text-slate-500 mt-1">Pantau kedisplinan dan riwayat kehadiran Anda.</p>
                    </div>
                  </div>

                  {/* Summary Stats Row */}
                  <div className="grid grid-cols-2 md:grid-cols-3 md:grid-cols-6 gap-4">
                    {[
                      { label: "Hadir", value: attendanceSummary?.Hadir || 0, color: "bg-emerald-50 text-emerald-600 border-emerald-100", icon: CheckCircle2 },
                      { label: "Sakit", value: attendanceSummary?.Sakit || 0, color: "bg-blue-50 text-blue-600 border-blue-100", icon: HeartPulse },
                      { label: "Izin", value: attendanceSummary?.Izin || 0, color: "bg-amber-50 text-amber-600 border-amber-100", icon: FileText },
                      { label: "Alpa", value: attendanceSummary?.Alpa || 0, color: "bg-rose-50 text-rose-600 border-rose-100", icon: AlertCircle },
                      { label: "Dispen", value: attendanceSummary?.Dispen || 0, color: "bg-purple-50 text-purple-600 border-purple-100", icon: ShieldCheck },
                      { label: "Total Hadir", value: (attendanceSummary?.percentage || "0") + "%", color: "bg-indigo-50 text-indigo-600 border-indigo-100", icon: TrendingUp },
                    ].map((stat, idx) => (
                      <div key={`att-stat-item-${stat.label || idx}-${idx}`} className={`p-4 rounded-2xl border-2 shadow-sm flex flex-col items-center justify-center text-center gap-2 ${stat.color}`}>
                        <stat.icon className="w-5 h-5 opacity-80" />
                        <div className="flex flex-col">
                          <span className="text-2xl font-black">{stat.value}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{stat.label}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Charts Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Donut Chart Card */}
                    <div className="md:col-span-1 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center justify-center min-h-[400px]">
                      <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 mb-8 self-start">Distribusi Kehadiran</h3>
                      <div className="w-full h-64 relative">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={attendanceChartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {attendanceChartData.map((entry: any, index: number) => (
                                <Cell key={`att-pie-cell-${entry.name || index}-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <span className="text-3xl font-black text-slate-900">{attendanceSummary?.percentage}%</span>
                          <span className="text-[10px] font-bold text-slate-400 uppercase">Hadir</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-8 gap-y-2 mt-6">
                        {attendanceChartData.map((entry: any, idx: number) => (
                          <div key={`att-legend-${entry.name || idx}-${idx}`} className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }}></div>
                            <span className="text-xs font-bold text-slate-600">{entry.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Stats Summary Card */}
                    <div className="md:col-span-2 bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-center relative group">
                       <div className="absolute -right-8 -top-8 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-colors"></div>
                       <div className="flex items-center gap-6 mb-8 relative z-10">
                          <div className="w-16 h-16 rounded-[1.75rem] bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center shadow-[0_10px_25px_-5px_rgba(37,99,235,0.4)]">
                             <Calendar className="w-8 h-8" />
                          </div>
                          <div>
                             <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">Total Pertemuan Terdata</h3>
                             <div className="flex items-baseline gap-2">
                               <span className="text-5xl font-black text-slate-900 tracking-tight">
                                 {attendanceSummary?.totalMeetings || 0}
                               </span>
                               <span className="text-sm font-black text-blue-600 uppercase tracking-widest">Pertemuan</span>
                             </div>
                          </div>
                       </div>
                       
                       <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-3xl">
                             <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1">Status Kehadiran</p>
                             <p className="text-lg font-black text-slate-900">{attendanceSummary?.rubricStatus || "Memuat..."}</p>
                             <p className="text-xs font-bold text-emerald-600/70 mt-1">Di atas rata-rata kelas</p>
                          </div>
                          <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl">
                             <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Update Terakhir</p>
                             <p className="text-lg font-black text-slate-900">Hari ini</p>
                             <p className="text-xs font-bold text-slate-400 mt-1">{new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB</p>
                          </div>
                       </div>
                    </div>
                  </div>

                  {/* History Table */}
                  <div className="bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/60 overflow-hidden relative">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"></div>
                    <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-white/50 backdrop-blur-md">
                      <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">Log Kehadiran Mendalam</h3>
                    </div>
                    <div className="overflow-x-auto p-4 sm:p-8">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b-2 border-slate-200">
                            <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap rounded-tl-2xl">Tanggal / Hari</th>
                            <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Status</th>
                            <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Keterangan</th>
                            <th className="py-4 px-4 text-right bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap rounded-tr-2xl">Diverifikasi Oleh</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {studentAttendanceData.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="py-20 text-center border-b border-slate-100">
                                <div className="flex flex-col items-center gap-4 text-slate-300">
                                  <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center">
                                    <Calendar className="w-8 h-8 opacity-50" />
                                  </div>
                                  <p className="text-[10px] font-black uppercase tracking-widest">Belum ada riwayat kehadiran</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            studentAttendanceData.map((record, idx) => {
                              const dateObj = new Date(record.date);
                              const dayName = dateObj.toLocaleDateString('id-ID', { weekday: 'long' });
                              const dateFormatted = dateObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
                              
                              let statusBadge = "bg-slate-100 text-slate-600 border-slate-200";
                              if (record.status === "Hadir") statusBadge = "bg-emerald-50 text-emerald-700 border-emerald-100";
                              else if (record.status === "Sakit") statusBadge = "bg-blue-50 text-blue-700 border-blue-100";
                              else if (record.status === "Izin") statusBadge = "bg-amber-50 text-amber-700 border-amber-100";
                              else if (record.status === "Alpa") statusBadge = "bg-rose-50 text-rose-700 border-rose-100";
                              else if (record.status === "Dispen") statusBadge = "bg-purple-50 text-purple-700 border-purple-100";

                              return (
                                <tr key={`record-${record.id || idx}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                  <td className="py-4 px-4 whitespace-nowrap">
                                    <div className="flex flex-col">
                                      <span className="font-bold text-slate-900">{dateFormatted}</span>
                                      <span className="text-[10px] font-black text-slate-400 mt-0.5 uppercase tracking-wider">{dayName}</span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-center whitespace-nowrap">
                                    <span className={`inline-flex items-center justify-center px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest ${statusBadge}`}>
                                      {record.status}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4 whitespace-nowrap">
                                    <p className="text-[11px] font-bold text-slate-500 max-w-[200px] truncate" title={record.keterangan || "-"}>
                                      {record.keterangan || "-"}
                                    </p>
                                  </td>
                                  <td className="py-4 px-4 text-right whitespace-nowrap">
                                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-600">{record.teacher}</span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Materi Ajar Menu */}
              {activeMenu === "materi" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mt-4 mb-6 gap-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-display font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent tracking-tight leading-tight">Materi Ajar</h2>
                      <p className="text-sm font-semibold text-slate-500 mt-1">Akses semua materi pelajaran Informatika kapan saja untuk mendukung proses belajarmu.</p>
                    </div>
                  </div>

                  {/* Subject Header Card */}
                  <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-50 rounded-full -translate-y-1/2 translate-x-1/2 opacity-50 group-hover:scale-110 transition-transform duration-700"></div>
                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-[2rem] bg-blue-50 border-2 border-blue-100 flex items-center justify-center relative z-10 shrink-0">
                      <MonitorIcon className="w-12 h-12 sm:w-16 sm:h-16 text-blue-600" />
                    </div>
                    <div className="flex-1 relative z-10 text-center md:text-left">
                      <h3 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Informatika</h3>
                      <div className="flex flex-wrap items-center justify-center md:justify-start gap-x-4 gap-y-1 mt-2 text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest">
                        <span>Kelas {student?.kelas || "Informatika"}</span>
                      </div>
                      <p className="text-xs sm:text-sm font-bold text-slate-600 mt-4">Guru: Agan Parta, S.Kom.</p>
                    </div>
                    <div className="w-full md:w-64 relative z-10 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Progress Belajar</span>
                        <span className="text-xl font-black text-blue-600">{materialStats.percentage}%</span>
                      </div>
                      <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${materialStats.percentage}%` }}
                          className="h-full bg-blue-500 rounded-full"
                        ></motion.div>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400 mt-3 uppercase tracking-wider">{materialStats.selesai} dari {materialStats.total} materi selesai</p>
                    </div>
                  </div>



                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Total Materi", value: materialStats.total, color: "bg-slate-50 text-slate-600 border-slate-200", icon: BookOpen },
                      { label: "Selesai", value: materialStats.selesai, color: "bg-emerald-50 text-emerald-600 border-emerald-100", icon: CheckCircle2 },
                      { label: "Sedang Dipelajari", value: materialStats.sedang, color: "bg-amber-50 text-amber-600 border-amber-100", icon: History },
                      { label: "Belum Dimulai", value: materialStats.belum, color: "bg-rose-50 text-rose-600 border-rose-100", icon: AlertCircle },
                    ].map((stat, idx) => (
                      <div key={`mat-stat-box-${stat.label || idx}-${idx}`} className={`p-4 sm:p-5 rounded-[2rem] border shadow-sm flex flex-col sm:flex-row items-center sm:items-center text-center sm:text-left gap-2 sm:gap-4 ${stat.color}`}>
                        <div className="w-12 h-12 rounded-2xl bg-white border border-inherit flex items-center justify-center shrink-0">
                          <stat.icon className="w-6 h-6" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xl sm:text-2xl font-black leading-none">{stat.value}</p>
                          <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-wide opacity-60 leading-tight mt-1 break-words sm:break-normal">
                            {stat.label}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Materials List Table */}
                  <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden">
                    <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                      <h3 className="text-xs font-black uppercase tracking-widest text-slate-500">Daftar Materi</h3>
                      <span className="text-xs font-black text-[#85cc00] bg-[#85cc00]/10 px-4 py-1.5 rounded-full uppercase tracking-wider">
                        Total: {filteredMaterials.length} Materi
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-50 z-10 border-b-2 border-slate-200">
                          <tr>
                            <th className="py-4 px-4 text-center w-16 bg-slate-50 rounded-tl-2xl font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">No</th>
                            <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Bab dan Materi</th>
                            <th className="py-4 px-4 text-center w-48 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Progres Belajar</th>
                            <th className="py-4 px-4 text-center w-36 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Aksi</th>
                            <th className="py-4 px-4 text-center w-36 bg-slate-50 rounded-tr-2xl font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Status</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white">
                          {filteredMaterials.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-20 text-center border-b border-slate-100">
                                <div className="flex flex-col items-center gap-3 text-slate-300">
                                  <BookOpen className="w-12 h-12 stroke-1" />
                                  <p className="text-sm font-black uppercase tracking-widest text-slate-400">Materi tidak ditemukan</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            filteredMaterials.map((material, idx) => {
                              const progress = materialsProgress[material.id];
                              const status = progress?.status || "Belum Dimulai";
                              
                              let displayStatus = "Belum Dimulai";
                              let statusBadgeStyle = "bg-slate-100 text-slate-600 border-slate-300";
                              
                              if (status === "Selesai") {
                                displayStatus = "Selesai";
                                statusBadgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-200";
                              } else if (status === "Sedang Dipelajari") {
                                displayStatus = "Dipelajari";
                                statusBadgeStyle = "bg-amber-50 text-amber-700 border-amber-200";
                              }

                              return (
                                <tr key={`mat-${material.id || idx}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                  <td className="py-4 px-4 text-center font-black text-slate-400 whitespace-nowrap">
                                    {idx + 1}
                                  </td>
                                  <td className="py-4 px-4 text-left whitespace-nowrap">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{material.bab}</span>
                                      <span className="text-sm font-bold text-slate-900 leading-snug">{material.title}</span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-center whitespace-nowrap">
                                    <div className="flex flex-col items-center gap-1.5">
                                      <span className={`inline-flex px-2.5 py-1 rounded border text-[9px] font-black uppercase tracking-widest ${statusBadgeStyle}`}>
                                        {displayStatus}
                                      </span>
                                      {/* Progress Bar */}
                                      <div className="w-full max-w-[120px] h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                        <div 
                                          className={`h-full transition-all duration-500 ${status === "Selesai" ? "bg-emerald-500" : "bg-[#85cc00]"}`}
                                          style={{ width: `${progress?.percentage || 0}%` }}
                                        />
                                      </div>
                                      <span className="text-[10px] font-black text-slate-500 leading-none">
                                        {(progress?.percentage || 0)}%
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-center whitespace-nowrap">
                                    <button 
                                      onClick={() => handleOpenMaterial(material.id, material.driveUrl)}
                                      className="px-4 py-2 bg-[#85cc00] hover:brightness-110 text-slate-950 font-black uppercase tracking-widest text-[10px] rounded-lg shadow-sm hover:shadow transition-all cursor-pointer"
                                    >
                                      Lihat Materi
                                    </button>
                                  </td>
                                  <td className="py-4 px-4 text-center whitespace-nowrap">
                                    {progress?.percentage === 100 ? (
                                      <button 
                                        onClick={() => handleUpdateMaterialStatus(material.id, "Belum Dimulai")}
                                        className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] rounded-lg shadow-sm hover:shadow transition-all cursor-pointer"
                                        title="Aktifkan Kembali"
                                      >
                                        Aktifkan Kembali
                                      </button>
                                    ) : (
                                      <button 
                                        disabled
                                        className="px-4 py-2 bg-slate-100 text-slate-400 font-black uppercase tracking-widest text-[10px] rounded-lg border border-slate-200 transition-all cursor-not-allowed"
                                        title="Masih dalam proses"
                                      >
                                        {progress?.percentage ? "Sedang Dipelajari" : "Belum Dimulai"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Tips Section */}
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-3 md:gap-6">
                      <div className="w-16 h-16 rounded-[2rem] bg-blue-50 text-blue-600 flex items-center justify-center border-2 border-blue-100 shrink-0">
                        <Lightbulb className="w-8 h-8" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-widest text-slate-900">Tips Belajar</h4>
                        <p className="text-xs font-bold text-slate-500 mt-1 max-w-xl">Pelajari setiap Bab secara mendalam melalui Materi Pembelajaran sebelum menempuh Ujian CBT agar siap dengan soal-soal standar Kurikulum Merdeka. Sesuai dengan keadaan sistem terbaru pada saat ini.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setIsTipsModalOpen(true)}
                      className="px-8 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-2 shrink-0 group cursor-pointer"
                    >
                      Lihat Semua Tips
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                </div>
              )}

              {/* Ujian Online Menu */}
              {activeMenu === "ujian-online" && (
                <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-4 pb-12 animate-in fade-in duration-300">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mt-4 mb-6 gap-4">
                    <div>
                      <h2 className="text-3xl sm:text-4xl font-display font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent tracking-tight leading-tight">Pusat Ujian CBT</h2>
                      <p className="text-sm font-semibold text-slate-500 mt-1">Selesaikan ujian tepat waktu dan jaga integritas.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8">
                    {/* Stats & Guidelines */}
                    <div className="md:col-span-4 xl:col-span-3 space-y-6">
                      <div className="bg-sky-500 p-6 sm:p-8 rounded-[2.5rem] text-white shadow-xl shadow-sky-900/20 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-6 sm:p-8 opacity-10 group-hover:scale-110 transition-transform">
                          <ShieldAlert className="w-20 h-20 sm:w-24 h-24" />
                        </div>
                        <h4 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-sky-200 mb-6">Status Integritas</h4>
                        <div className="space-y-4 relative z-10">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 sm:w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center border border-white/20">
                              <ShieldCheck className={`w-5 h-5 sm:w-6 h-6 ${integrityStatus.color.includes('emerald') ? 'text-[#85cc00]' : integrityStatus.color}`} />
                            </div>
                            <div>
                              <p className="text-[9px] sm:text-[10px] font-bold text-sky-200 uppercase tracking-widest">Integritas Siswa</p>
                              <p className="text-base sm:text-lg font-black">{integrityStatus.text}</p>
                            </div>
                          </div>
                          <div className="p-4 bg-white/10 rounded-2xl border border-white/20 backdrop-blur-md">
                            <p className="text-[9px] sm:text-[10px] font-black text-white uppercase tracking-widest mb-2 drop-shadow-sm">Total Pelanggaran</p>
                            <div className="flex items-baseline gap-2">
                              <span className="text-2xl sm:text-3xl font-black text-white drop-shadow-sm">{examViolationCount}</span>
                              <span className="text-[10px] font-black text-white uppercase drop-shadow-sm">Kali Terdeteksi</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                        <h4 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-900 border-b border-slate-100 pb-4">Rubrik Integritas CBT</h4>
                        <div className="space-y-2.5">
                          {[
                            { label: "Sangat Berintegritas", desc: "0 Pelanggaran", color: "text-emerald-600", bg: "bg-emerald-50" },
                            { label: "Berintegritas", desc: "1 Peringatan", color: "text-teal-600", bg: "bg-teal-50" },
                            { label: "Cukup Berintegritas", desc: "2-3 Peringatan", color: "text-amber-600", bg: "bg-amber-50" },
                            { label: "Kurang Berintegritas", desc: "4-5 Pelanggaran", color: "text-orange-600", bg: "bg-orange-50" },
                            { label: "Sangat Kurang Berintegritas", desc: "≥ 6 Pelanggaran", color: "text-rose-600", bg: "bg-rose-50" },
                          ].map((item, idx) => {
                            const isActive = integrityStatus.text === item.label;
                            return (
                              <div key={`integ-stat-${item.label || idx}-${idx}`} className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${isActive ? 'bg-slate-900 border-slate-900 shadow-lg scale-[1.02]' : 'bg-slate-50 border-slate-100'}`}>
                                 <span className={`text-[10px] sm:text-[11px] font-black uppercase tracking-tight shrink-0 ${isActive ? 'text-[#85cc00]' : item.color}`}>{item.label}</span>
                                 <span className={`text-[9px] sm:text-[10px] font-bold ${isActive ? 'text-slate-400' : 'text-slate-400'} italic shrink-0`}>{item.desc}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="bg-white p-6 sm:p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                        <h4 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-900 border-b border-slate-100 pb-4">Panduan Integritas CBT</h4>
                        <ul className="space-y-4">
                          {[
                            "Dilarang berpindah tab atau aplikasi.",
                            "Dilarang mengambil tangkapan layar (screenshot).",
                            "Dilarang menyalin (copy) atau menempel (paste) teks.",
                            "Pastikan koneksi internet stabil selama ujian.",
                            "Selesaikan ujian sebelum waktu berakhir."
                          ].map((tip, idx) => (
                            <li key={`exam-rule-tip-${idx}`} className="flex gap-3 text-[10px] sm:text-[11px] font-bold text-slate-500 leading-relaxed group">
                              <span className="w-5 h-5 rounded-lg bg-slate-50 text-slate-400 flex items-center justify-center shrink-0 border border-slate-100 group-hover:text-blue-500 group-hover:bg-blue-50 transition-colors">{idx + 1}</span>
                              <span className="break-words">{tip}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    {/* Exams List */}
                    <div className="md:col-span-8 xl:col-span-9 space-y-6">
                      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden min-h-[500px]">
                        <div className="p-6 sm:p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                           <div className="flex items-center gap-3">
                              <MonitorIcon className="w-5 h-5 text-blue-600" />
                              <h3 className="text-[11px] sm:text-sm font-black uppercase tracking-widest text-slate-900">Daftar Ujian Aktif & Tersedia</h3>
                           </div>
                        </div>
                        
                        <div className="p-6 sm:p-8">
                          {examsList.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
                              <div className="w-20 h-20 sm:w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 border border-slate-100 shadow-inner">
                                <FileEdit className="w-10 h-10 sm:w-12 h-12" />
                              </div>
                              <div className="space-y-2">
                                <h4 className="text-base sm:text-lg font-black text-slate-900">Tidak Ada Ujian Aktif</h4>
                                <p className="text-xs sm:text-sm font-bold text-slate-400 max-w-xs mx-auto">Saat ini belum ada jadwal ujian yang tersedia untuk kelas Anda. Silakan hubungi wali kelas jika ada kekeliruan.</p>
                              </div>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="border-b-2 border-slate-200">
                                    <th className="py-4 px-4 text-center w-16 bg-slate-50 rounded-tl-2xl font-black text-xs text-slate-500 uppercase tracking-widest">No</th>
                                    <th className="py-4 px-4 bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Nama Bab</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Jenis Ujian</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Pelanggaran</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Status Integritas</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Nilai</th>
                                    <th className="py-4 px-4 text-center bg-slate-50 rounded-tr-2xl font-black text-xs text-slate-500 uppercase tracking-widest whitespace-nowrap">Status Ujian</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {examsList.map((exam: any, idx: number) => {
                                    const finalGrade = finalGradesList.find(f => f.assignmentId === exam.id && f.nisn === student?.nisn);
                                    const isFinished = !!finalGrade;
                                    const violations = finalGrade?.violationCount || finalGrade?.violationsCount || 0;
                                    const nilai = finalGrade?.nilai !== undefined ? finalGrade.nilai : "-";
                                    
                                    const getIntegrityStatus = (v: number) => {
                                      if (v === 0) return { text: "Sangat Berintegritas", color: "text-emerald-600 bg-emerald-50 border-emerald-100" };
                                      if (v <= 2) return { text: "Berintegritas", color: "text-blue-600 bg-blue-50 border-blue-100" };
                                      if (v <= 4) return { text: "Cukup Berintegritas", color: "text-amber-600 bg-amber-50 border-amber-100" };
                                      return { text: "Kurang Berintegritas", color: "text-rose-600 bg-rose-50 border-rose-100" };
                                    };
                                    
                                    const integrity = getIntegrityStatus(violations);
                                    
                                    return (
                                      <tr key={`exam-${exam.id || idx}-${idx}`} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="py-4 px-4 text-center font-black text-slate-400">{idx + 1}</td>
                                        <td className="py-4 px-4 whitespace-nowrap">
                                          <p className="font-bold text-slate-900">{exam.title}</p>
                                          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{exam.bab || "BAB BELUM DIATUR"} • {exam.subject}</p>
                                          {exam.externalQuizUrl && (
                                            <a
                                              href={exam.externalQuizUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                                            >
                                              <ExternalLink className="w-2.5 h-2.5" />
                                              Soal PDF / Notebook LM
                                            </a>
                                          )}
                                        </td>
                                        <td className="py-4 px-4 text-center font-bold text-slate-600 whitespace-nowrap">
                                          {exam.category || exam.type || "Pilihan Ganda"}
                                        </td>
                                        <td className="py-4 px-4 text-center whitespace-nowrap">
                                          {isFinished ? (
                                            <span className="font-bold text-slate-700">{violations} Kali</span>
                                          ) : "-"}
                                        </td>
                                        <td className="py-4 px-4 text-center whitespace-nowrap">
                                          {isFinished ? (
                                            <span className={`inline-flex items-center px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded border ${integrity.color}`}>
                                              {integrity.text}
                                            </span>
                                          ) : "-"}
                                        </td>
                                        <td className="py-4 px-4 text-center whitespace-nowrap">
                                          {isFinished ? (
                                            <span className="font-black text-slate-900">{nilai}</span>
                                          ) : "-"}
                                        </td>
                                        <td className="py-4 px-4 text-center whitespace-nowrap">
                                          {isFinished ? (
                                            <button disabled className="px-4 py-2 bg-slate-100 text-slate-400 font-bold uppercase tracking-widest text-[10px] rounded-lg cursor-not-allowed">
                                              Selesai
                                            </button>
                                          ) : (
                                            <button 
                                              onClick={() => {
                                                setSelectedExamForToken(exam);
                                                setTokenInput("");
                                                setExamTokenError("");
                                              }}
                                              className="px-4 py-2 bg-slate-900 text-white hover:bg-[#85cc00] hover:text-slate-900 font-black uppercase tracking-widest text-[10px] rounded-lg transition-all shadow-md active:scale-95 cursor-pointer"
                                            >
                                              Mulai Ujian
                                            </button>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Info Banner */}
                      <div className="bg-emerald-50 p-6 sm:p-8 rounded-[2.5rem] border border-emerald-100 flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex items-center gap-4 sm:gap-6">
                          <div className="w-12 h-12 sm:w-16 h-16 rounded-[2rem] bg-white text-emerald-600 flex items-center justify-center border-2 border-emerald-100 shrink-0 shadow-sm">
                            <LockIcon className="w-6 h-6 sm:w-8 h-8" />
                          </div>
                          <div>
                            <h4 className="text-[10px] sm:text-sm font-black uppercase tracking-widest text-slate-900">Keamanan Terjamin</h4>
                            <p className="text-[10px] sm:text-xs font-bold text-slate-500 mt-1 max-w-xl">Sistem CBT menggunakan enkripsi data dan monitoring integritas real-time.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Beautiful Unified Footer */}
              <footer className="w-full mt-8 pt-8 pb-4 border-t border-slate-200/40 flex flex-col items-center justify-center text-center relative z-10">
                <div className="flex items-center gap-2 mb-1 bg-transparent">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#85cc00] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#85cc00]"></span>
                  </span>
                  <span className="text-slate-600 font-semibold text-xs tracking-tight px-1">
                    App Development by <span className="text-[#649c00]">Agan Parta,S.Kom.Gr</span>
                  </span>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#85cc00] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#85cc00]"></span>
                  </span>
                </div>

                <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 select-none">
                  Kreativitas Tanpa Batas • Inovasi Tiada Henti
                </p>

                <p className="text-slate-400 font-medium text-xs leading-normal mb-2 select-none">
                  Transformasi Digital Pendidikan Untuk Generasi Emas yang Cerdas dan Berakhlak
                </p>

                <div className="flex items-center justify-center gap-4 text-[10px] font-semibold text-slate-400 tracking-wider uppercase select-none">
                  <span>V2.1.0</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#85cc00]/80"></div>
                  <span>ENTERPRISE</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#85cc00]/80"></div>
                  <span>STABLE</span>
                </div>
              </footer>
              </div>
            </>
        ) : (
            /* ACTIVE EXAM UI (CBT) */
            <div className="fixed inset-0 z-[100] bg-slate-100 flex flex-col overflow-hidden select-none" onContextMenu={(e) => e.preventDefault()}>
              {/* CBT Header */}
              <header className="h-16 bg-gradient-to-r from-white via-white to-emerald-50 text-slate-800 border-b border-emerald-100 px-4 md:px-6 flex items-center justify-between shrink-0 shadow-sm relative z-20">
                {/* Left: No Urut Soal Toggle Button */}
                <div className="flex items-center">
                  <button
                    onClick={() => setIsQuestionNavOpen(!isQuestionNavOpen)}
                    className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-emerald-50 text-emerald-800 hover:text-emerald-950 border border-emerald-200/80 rounded-xl transition-all font-black text-xs cursor-pointer shadow-sm shrink-0 active:scale-95"
                    title={isQuestionNavOpen ? "Sembunyikan Nomor Soal" : "Tampilkan Nomor Soal"}
                  >
                    <LayoutGrid className="w-4 h-4 text-emerald-600" />
                    <span>No. Urut Soal</span>
                  </button>
                </div>

                {/* Center: Waktu Ujian perfectly centered with light emerald theme */}
                <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 bg-emerald-50/80 border border-emerald-200/60 rounded-2xl shadow-sm shrink-0">
                  <Timer className={`w-3.5 h-3.5 md:w-4 md:h-4 ${examTimer < 300 ? "text-rose-500 animate-pulse" : "text-emerald-600"}`} />
                  <div className="flex items-center gap-1.5 leading-none">
                    <span className="text-[9px] md:text-[11px] font-black text-emerald-800/70 uppercase tracking-widest hidden xs:inline">Sisa Waktu:</span>
                    <span className={`text-xs md:text-base font-mono font-black tracking-wider ${examTimer < 300 ? "text-rose-600 animate-pulse" : "text-emerald-700"}`}>
                      {formatTime(examTimer)}
                    </span>
                  </div>
                </div>

                {/* Right: Tombol Selesai */}
                <div className="flex items-center">
                  <button 
                    onClick={handleTrySubmit}
                    className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black uppercase text-xs tracking-wider rounded-xl transition-all shadow-md shadow-rose-600/25 cursor-pointer border border-rose-500/10 shrink-0"
                  >
                    <span>Selesai</span>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </header>

              <div className="flex-1 flex overflow-hidden relative">
                
                {/* Mobile Overlay */}
                <AnimatePresence>
                  {isQuestionNavOpen && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-slate-900/50 backdrop-blur-md z-20 md:hidden"
                      onClick={() => setIsQuestionNavOpen(false)}
                    />
                  )}
                </AnimatePresence>

                {/* Left Sidebar: Question Numbers Grid */}
                <aside className={`absolute lg:static inset-y-0 left-0 z-30 w-72 md:w-80 bg-white border-r border-slate-200 overflow-y-auto flex flex-col shrink-0 custom-scrollbar transition-all duration-300 ease-in-out ${isQuestionNavOpen ? "translate-x-0 shadow-2xl lg:shadow-none" : "-translate-x-full lg:translate-x-0 lg:w-0 overflow-hidden border-none"}`}>
                  <div className="p-6 md:p-6 space-y-6 flex flex-col h-full justify-between">
                    <div className="space-y-6">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Navigasi Soal</h3>
                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">
                          {Object.keys(examAnswers).length} / {activeExam.questions?.length || 0} Selesai
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {activeExam.questions?.map((_: any, idx: number) => {
                          const isCurrent = currentQuestionIdx === idx;
                          const isAnswered = examAnswers[idx] !== undefined;
                          const isFlagged = examFlags[idx];
                          
                          let bgColor = "bg-white border-slate-200 text-slate-400 hover:border-blue-400 hover:text-blue-500";
                          if (isCurrent) bgColor = "bg-blue-600 border-blue-600 text-white shadow-md font-black";
                          else if (isFlagged) bgColor = "bg-amber-400 border-amber-400 text-white shadow-md";
                          else if (isAnswered) bgColor = "bg-emerald-500 border-emerald-500 text-white shadow-md";

                          return (
                            <button
                              key={`cbt-nav-btn-q-${idx}`}
                              onClick={() => {
                                setCurrentQuestionIdx(idx);
                                if (window.innerWidth < 1024) {
                                  setIsQuestionNavOpen(false);
                                }
                              }}
                              className={`w-full aspect-square rounded-xl border flex items-center justify-center text-xs font-bold transition-all ${bgColor} cursor-pointer`}
                            >
                              {idx + 1}
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-2.5 pt-4 border-t border-slate-100">
                         <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Keterangan</h4>
                         <div className="grid grid-cols-2 gap-2">
                            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                              <div className="w-3 h-3 rounded bg-blue-600 shrink-0"></div>
                              <span className="text-[10px] font-bold text-slate-600">Aktif</span>
                            </div>
                            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                              <div className="w-3 h-3 rounded bg-emerald-500 shrink-0"></div>
                              <span className="text-[10px] font-bold text-slate-600">Terisi</span>
                            </div>
                            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                              <div className="w-3 h-3 rounded bg-amber-400 shrink-0"></div>
                              <span className="text-[10px] font-bold text-slate-600">Ragu</span>
                            </div>
                            <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                              <div className="w-3 h-3 rounded bg-white border border-slate-200 shrink-0"></div>
                              <span className="text-[10px] font-bold text-slate-600">Kosong</span>
                            </div>
                         </div>
                      </div>
                    </div>

                    {/* Selesai Ujian button at bottom of sidebar */}
                    <div className="pt-6 border-t border-slate-100">
                      <button
                        onClick={handleTrySubmit}
                        className="w-full py-3.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-black uppercase text-xs tracking-wider rounded-xl transition-all shadow-lg shadow-rose-600/20 cursor-pointer border border-rose-500/10 flex items-center justify-center gap-2"
                      >
                        <span>Selesai Ujian</span>
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </aside>

                {/* Main Content Area */}
                <main className="flex-1 overflow-y-auto bg-slate-50 custom-scrollbar relative">
                  <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-5">
                    {/* Dokumen / Kuis Soal Eksternal (PDF Drive / Notebook LM) */}
                    {activeExam.externalQuizUrl && (
                      <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-sky-50 border-2 border-blue-200 rounded-3xl p-5 md:p-6 shadow-sm space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-start sm:items-center gap-3">
                            <div className="p-2.5 bg-blue-600 text-white rounded-2xl shadow-sm shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-extrabold text-slate-900 text-sm md:text-base">
                                  Lembar Soal Luar (PDF / Kuis Notebook LM)
                                </h4>
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-800 text-[10px] font-black uppercase tracking-wider rounded-md">
                                  Tersedia
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 font-medium mt-0.5">
                                Baca butir soal pada dokumen PDF atau buka kuis Notebook LM, lalu tentukan jawaban A, B, C, D, E pada lembar jawaban di bawah.
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setShowEmbeddedPdf(!showEmbeddedPdf)}
                              className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-sm ${
                                showEmbeddedPdf
                                  ? "bg-slate-800 text-white hover:bg-slate-900"
                                  : "bg-blue-600 text-white hover:bg-blue-700 active:scale-95"
                              }`}
                            >
                              <Eye className="w-4 h-4" />
                              <span>{showEmbeddedPdf ? "Tutup Pratinjau PDF" : "Tampilkan PDF di Layar"}</span>
                            </button>
                            <a
                              href={activeExam.externalQuizUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2.5 bg-white hover:bg-slate-50 text-blue-700 border border-blue-200 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                            >
                              <span>Buka di Tab Baru</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>

                        {/* Embedded PDF Viewer Frame */}
                        {showEmbeddedPdf && (
                          <div className="rounded-2xl border-2 border-blue-200 overflow-hidden bg-white shadow-inner">
                            <div className="bg-slate-900 px-4 py-2 flex items-center justify-between text-white text-xs">
                              <span className="font-bold flex items-center gap-2">
                                <FileText className="w-4 h-4 text-blue-400" /> Pratinjau Dokumen Soal (Google Drive PDF / Notebook LM)
                              </span>
                              <button
                                type="button"
                                onClick={() => setShowEmbeddedPdf(false)}
                                className="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
                              >
                                ✕ Tutup
                              </button>
                            </div>
                            <div className="w-full h-[500px] md:h-[650px] bg-slate-100">
                              <iframe
                                src={getDrivePdfEmbedUrl(activeExam.externalQuizUrl)}
                                className="w-full h-full border-none"
                                title="Dokumen Soal PDF"
                                allow="autoplay"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Top Control Bar of Exam (Font size & Connection status) */}
                    <div className="flex items-center justify-between bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">KONEKSI AMAN & STABIL</span>
                      </div>

                      {/* Font Size Selector */}
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider mr-1">Ukuran Soal:</span>
                        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200/50">
                          <button
                            onClick={() => setExamFontSize("normal")}
                            className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${examFontSize === "normal" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Kecil
                          </button>
                          <button
                            onClick={() => setExamFontSize("large")}
                            className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${examFontSize === "large" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Sedang
                          </button>
                          <button
                            onClick={() => setExamFontSize("xlarge")}
                            className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${examFontSize === "xlarge" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                          >
                            Besar
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Question Card */}
                    <div className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-slate-200 relative min-h-[400px] flex flex-col justify-between">
                      <div>
                        {/* Question Badge & Bookmark Header */}
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
                          <div className="flex items-center gap-3">
                            <span className="w-2 h-5 bg-blue-600 rounded-full"></span>
                            <h4 className="font-display font-black text-xs md:text-sm text-slate-800 tracking-wider uppercase">
                              SOAL NOMOR {currentQuestionIdx + 1} DARI {activeExam.questions?.length}
                            </h4>
                          </div>
                          
                          <button 
                            onClick={() => setExamFlags(prev => ({ ...prev, [currentQuestionIdx]: !prev[currentQuestionIdx] }))}
                            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border ${
                              examFlags[currentQuestionIdx]
                              ? "bg-amber-50 border-amber-400 text-amber-700 shadow-sm"
                              : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:border-slate-300"
                            }`}
                          >
                            <Flag className={`w-4 h-4 ${examFlags[currentQuestionIdx] ? "fill-amber-500 text-amber-500" : "cursor-pointer"}`} />
                            <span className="hidden sm:inline">Ragu-Ragu</span>
                          </button>
                        </div>

                        {/* Question Text Box with justify alignment (rata kiri rata kanan) */}
                        <div className="py-2 md:py-4">
                          <p className={`font-sans leading-[1.8] text-slate-800 tracking-normal text-justify whitespace-pre-line select-text hyphens-auto ${
                            examFontSize === "normal" ? "text-base md:text-lg" :
                            examFontSize === "large" ? "text-lg md:text-xl" : "text-xl md:text-2xl"
                          }`}>
                            {activeExam.questions[currentQuestionIdx]?.text}
                          </p>
                        </div>
                      </div>

                      {/* Options Block (Jawaban) with modern and professional design */}
                      <div className="mt-8 pt-8 border-t border-slate-100">
                        <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">
                          Pilihan Jawaban:
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {activeExam.questions[currentQuestionIdx]?.options.map((option: string, optIdx: number) => {
                            const isSelected = examAnswers[currentQuestionIdx] === optIdx;
                            const optionLabels = ["A", "B", "C", "D", "E"];
                            
                            return (
                              <button
                                key={`cbt-q-${currentQuestionIdx}-opt-${optIdx}`}
                                onClick={() => setExamAnswers(prev => ({ ...prev, [currentQuestionIdx]: optIdx }))}
                                className={`group flex items-start gap-4 p-4 rounded-2xl border transition-all duration-200 text-left relative overflow-hidden ${
                                  isSelected
                                    ? "bg-gradient-to-r from-blue-50/60 to-indigo-50/20 border-blue-600 ring-2 ring-blue-600/10 shadow-md shadow-blue-600/5"
                                    : "bg-white border-slate-200 hover:border-blue-300 hover:bg-slate-50/80 shadow-sm"
                                } cursor-pointer`}
                              >
                                {/* Compact & gorgeous alphabet badge - standard size */}
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 border transition-all ${
                                  isSelected
                                    ? "bg-blue-600 text-white border-blue-600 shadow-sm font-extrabold"
                                    : "bg-slate-50 text-slate-600 border-slate-200 group-hover:border-blue-200 group-hover:bg-white"
                                }`}>
                                  {optionLabels[optIdx]}
                                </div>
                                
                                {/* Option text content */}
                                <div className={`flex-1 pr-2 ${
                                  examFontSize === "normal" ? "text-sm md:text-base" :
                                  examFontSize === "large" ? "text-base md:text-lg" : "text-lg md:text-xl"
                                }`}>
                                  <span className={`leading-relaxed transition-colors ${isSelected ? "text-blue-900 font-extrabold" : "text-slate-700 font-medium group-hover:text-slate-900"}`}>
                                    {option}
                                  </span>
                                </div>

                                {/* Active Radio indicator on the right side */}
                                <div className="shrink-0 flex items-center justify-center h-8">
                                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                                    isSelected 
                                      ? "border-blue-600 bg-blue-600 text-white shadow-sm" 
                                      : "border-slate-300 bg-white group-hover:border-slate-400"
                                  }`}>
                                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white animate-scaleIn"></div>}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Keterangan Bab & Jenis Tes yang diujikan (saved Bab metadata box) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Materi Ujian Box */}
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                            <BookOpen className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider leading-none">Mata Pelajaran / Bab</span>
                            <span className="text-xs md:text-sm font-extrabold text-slate-700 mt-1 truncate max-w-[200px]">
                              {activeExam.bab || activeExam.subject || "Umum / Semua Bab"}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Jenis Tes Box (Pretest/Posttest/Ulangan Harian) */}
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                            <GraduationCap className="w-4 h-4" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider leading-none">Jenis Tes / Ujian</span>
                            <span className="text-xs md:text-sm font-extrabold text-emerald-700 mt-1 uppercase">
                              {activeExam.category && activeExam.category !== "Pilihan Ganda" 
                                ? activeExam.category 
                                : activeExam.title?.toLowerCase().includes("pretest") ? "Pretest"
                                : activeExam.title?.toLowerCase().includes("posttest") ? "Posttest"
                                : activeExam.title?.toLowerCase().includes("latihan") ? "Latihan Ujian"
                                : activeExam.title?.toLowerCase().includes("pat") ? "Penilaian Akhir Tahun (PAT)"
                                : activeExam.title?.toLowerCase().includes("ulangan") ? "Ulangan Harian"
                                : "Ulangan Harian / Sumatif CBT"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Nav Controls */}
                    <div className="flex items-center justify-between gap-4 pb-12 pt-1">
                      <button
                        disabled={currentQuestionIdx === 0}
                        onClick={() => setCurrentQuestionIdx(prev => prev - 1)}
                        className="flex-1 h-14 bg-white border border-slate-300 hover:border-slate-400 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 cursor-pointer shadow-sm"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>Sebelumnya</span>
                      </button>
                      
                      {/* Interactive Ragu Toggle in the middle for ease of access */}
                      <button 
                        onClick={() => setExamFlags(prev => ({ ...prev, [currentQuestionIdx]: !prev[currentQuestionIdx] }))}
                        className={`flex-1 h-14 rounded-2xl flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider transition-all border ${
                          examFlags[currentQuestionIdx]
                          ? "bg-amber-400 text-white border-amber-400 hover:bg-amber-500"
                          : "bg-white border-slate-300 text-amber-600 hover:bg-amber-50/50 border-dashed"
                        }`}
                      >
                        <Flag className="w-4 h-4 fill-current" />
                        <span>Ragu-Ragu</span>
                      </button>

                      <button
                        onClick={() => {
                          if (currentQuestionIdx < activeExam.questions.length - 1) {
                            setCurrentQuestionIdx(prev => prev + 1);
                          } else {
                            handleTrySubmit();
                          }
                        }}
                        className="flex-[1.5] h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center gap-2 text-xs font-black uppercase tracking-wider hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-600/25 cursor-pointer border border-transparent"
                      >
                        <span>{currentQuestionIdx === activeExam.questions.length - 1 ? "Selesai Ujian" : "Lanjutkan"}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </main>
              </div>
            </div>
          )}
      
      {/* Upload Modal with Multi-Page Scanner (Auto-PDF) and Link Submission */}
      {isUploadModalOpen && selectedTugas && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => !isUploading && !isProcessingScan && setIsUploadModalOpen(false)}
          ></div>
          <div className="relative w-full max-w-2xl bg-white rounded-3xl overflow-hidden shadow-2xl border border-slate-200 z-10 mx-4 max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="p-4 px-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#85cc00]/20 text-[#85cc00] flex items-center justify-center font-bold">
                  {submissionTab === "scan" ? <Camera className="w-4 h-4" /> : <Link className="w-4 h-4" />}
                </div>
                <div>
                  <h4 className="font-display font-black text-xs uppercase tracking-wider text-slate-900">
                    PENGUMPULAN TUGAS SISWA
                  </h4>
                  <p className="text-[10px] font-bold text-slate-400">
                    {selectedTugas.materi || "Materi Pelajaran"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isUploading && !isProcessingScan && setIsUploadModalOpen(false)}
                className="p-1.5 hover:bg-slate-200/70 rounded-xl text-slate-400 hover:text-slate-900 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="px-6 pt-3 pb-1 bg-white border-b border-slate-100 shrink-0">
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-2xl gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setSubmissionTab("scan");
                    setUploadMessage(null);
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-black transition-all ${
                    submissionTab === "scan"
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200/70"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Camera className="w-3.5 h-3.5 text-[#85cc00]" />
                  <span>📸 Pindai / Foto Catatan (PDF)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSubmissionTab("link");
                    setUploadMessage(null);
                  }}
                  className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-black transition-all ${
                    submissionTab === "link"
                      ? "bg-white text-slate-900 shadow-sm border border-slate-200/70"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Link className="w-3.5 h-3.5 text-blue-600" />
                  <span>🔗 Link Drive / CamScanner</span>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-4">
              {(isUploading || isProcessingScan || uploadMessage) && (
                <div className="w-full p-3 border border-slate-100 rounded-2xl bg-slate-50/60">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`p-1 rounded-md ${isUploading || isProcessingScan ? 'bg-sky-100 text-sky-600 animate-spin' : (uploadMessage?.type === 'error' ? 'bg-rose-100 text-rose-600' : 'bg-[#85cc00]/20 text-[#85cc00]')}`}>
                      {isUploading || isProcessingScan ? <RefreshCw className="w-3.5 h-3.5" /> : (uploadMessage?.type === 'error' ? <AlertOctagon className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />)}
                    </div>
                    <h4 className="font-black text-[10px] uppercase tracking-wider text-slate-700">
                      {isUploading ? "MENYIMPAN TUGAS..." : isProcessingScan ? "MEMPROSES LEMBAR CATATAN..." : "STATUS INFORMASI"}
                    </h4>
                  </div>

                  {isUploading && (
                    <div className="space-y-1 mt-2">
                      <div className="flex justify-between items-center text-[9px] font-black text-slate-500 uppercase tracking-wider">
                        <span>Mengonversi &amp; Menyimpan...</span>
                        <span>{Math.round(uploadProgress)}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <motion.div 
                          className="bg-[#85cc00] h-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadProgress}%` }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </div>
                  )}
                  {uploadMessage && !isUploading && !isProcessingScan && (
                    <div className={`text-[10.5px] font-bold ${uploadMessage.type === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>
                      {uploadMessage.text}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 1: PINDAI / FOTO CATATAN MULTI-LEMBAR -> AUTO PDF */}
              {submissionTab === "scan" && (
                <div className="space-y-4">
                  {/* Action buttons to capture or pick images */}
                  <div className="p-4 bg-emerald-50/70 border-2 border-dashed border-emerald-300/80 rounded-2xl space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2.5 bg-white rounded-xl text-emerald-600 shadow-sm shrink-0">
                        <Layers className="w-5 h-5" />
                      </div>
                      <div className="space-y-0.5">
                        <h5 className="text-xs font-black text-slate-900 uppercase tracking-tight">
                          Pindai / Foto Catatan Buku Tugas
                        </h5>
                        <p className="text-[10px] text-slate-600 font-medium leading-relaxed">
                          Foto setiap lembar buku catatan Anda. Aplikasi akan <strong>otomatis menggabungkan seluruh lembar menjadi 1 file PDF utuh</strong> yang rapi untuk dibaca guru.
                        </p>
                      </div>
                    </div>

                    {/* Action buttons (Labels wrapping file inputs for reliable mobile triggering) */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <label
                        className={`py-3 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer ${
                          isUploading || isProcessingScan ? "opacity-50 pointer-events-none" : "active:scale-95"
                        }`}
                      >
                        <Camera className="w-4 h-4" />
                        <span>Ambil Foto Kamera</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/jpg,image/*"
                          capture="environment"
                          className="hidden"
                          disabled={isUploading || isProcessingScan}
                          onChange={(e) => {
                            handleAddScannedFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>

                      <label
                        className={`py-3 px-3 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl font-black text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer ${
                          isUploading || isProcessingScan ? "opacity-50 pointer-events-none" : "active:scale-95"
                        }`}
                      >
                        <ImageIcon className="w-4 h-4 text-emerald-600" />
                        <span>Pilih dari Galeri</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          disabled={isUploading || isProcessingScan}
                          onChange={(e) => {
                            handleAddScannedFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  {/* Scanned Pages List / Grid */}
                  {scannedPages.length > 0 ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                          <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                          Lembar Terpindai ({scannedPages.length} Halaman)
                        </span>
                        <button
                          type="button"
                          onClick={() => setScannedPages([])}
                          className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          Hapus Semua
                        </button>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {scannedPages.map((pageData, idx) => (
                          <div
                            key={`scanned-page-thumb-${idx}`}
                            className="relative group bg-slate-100 rounded-2xl overflow-hidden border-2 border-slate-200/90 aspect-[3/4] flex flex-col shadow-xs"
                          >
                            <img
                              src={pageData}
                              alt={`Halaman ${idx + 1}`}
                              className="w-full h-full object-cover cursor-pointer"
                              onClick={() => setPreviewModalIndex(idx)}
                            />
                            
                            {/* Page Badge */}
                            <div className="absolute top-1.5 left-1.5 bg-slate-900/80 backdrop-blur-xs text-white text-[9px] font-black px-1.5 py-0.5 rounded-md">
                              Hal {idx + 1}
                            </div>

                            {/* Control Overlay */}
                            <div className="absolute bottom-0 inset-x-0 bg-slate-900/85 backdrop-blur-xs p-1 flex items-center justify-around opacity-90 group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveScannedPage(idx, "up")}
                                className="p-1 text-white hover:text-[#85cc00] disabled:opacity-30 cursor-pointer"
                                title="Geser ke halaman sebelumnya"
                              >
                                <ArrowLeft className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreviewModalIndex(idx)}
                                className="p-1 text-white hover:text-sky-300 cursor-pointer"
                                title="Perbesar"
                              >
                                <Eye className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveScannedPage(idx)}
                                className="p-1 text-rose-400 hover:text-rose-300 cursor-pointer"
                                title="Hapus halaman ini"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === scannedPages.length - 1}
                                onClick={() => handleMoveScannedPage(idx, "down")}
                                className="p-1 text-white hover:text-[#85cc00] disabled:opacity-30 cursor-pointer"
                                title="Geser ke halaman berikutnya"
                              >
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Add more page tile */}
                        <label
                          className={`border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50 hover:bg-emerald-50/40 rounded-2xl aspect-[3/4] flex flex-col items-center justify-center gap-1.5 transition-all text-slate-500 hover:text-emerald-700 cursor-pointer ${
                            isUploading || isProcessingScan ? "opacity-50 pointer-events-none" : ""
                          }`}
                        >
                          <Plus className="w-6 h-6" />
                          <span className="text-[10px] font-black uppercase tracking-tight text-center px-1">
                            + Tambah Lembar
                          </span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/jpg,image/*"
                            capture="environment"
                            className="hidden"
                            disabled={isUploading || isProcessingScan}
                            onChange={(e) => {
                              handleAddScannedFiles(e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>

                      <div className="p-3 bg-slate-100 rounded-xl text-[10px] text-slate-600 font-bold flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>Seluruh lembar foto telah dioptimalkan resolusinya dan siap dijadikan 1 dokumen PDF tugas.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 px-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1">
                      <FileText className="w-8 h-8 text-slate-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">Belum ada lembar catatan yang difoto</p>
                      <p className="text-[10px] text-slate-400">Klik tombol &quot;Ambil Foto Kamera&quot; di atas untuk mulai memfoto catatan tugas Anda.</p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: LINK TUGAS GOOGLE DRIVE / CAMSCANNER / LAINNYA */}
              {submissionTab === "link" && (
                <div className="space-y-3">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    Tautan / Link Tugas (Google Drive, CamScanner, Canva, OneDrive, Web, dll)
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Link className="h-4 w-4 text-slate-400" />
                    </div>
                    <input
                      ref={linkInputRef}
                      type="url"
                      value={selectedFile}
                      onChange={(e) => setSelectedFile(e.target.value)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (text) {
                          setSelectedFile(text.trim());
                        }
                      }}
                      placeholder="Tempel link Google Drive, CamScanner, Canva, OneDrive, PDF..."
                      className="block w-full pl-10 pr-36 py-3 border-2 border-slate-200 rounded-2xl text-xs font-semibold focus:outline-none focus:border-[#85cc00] transition-colors bg-slate-50/50"
                    />
                    <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
                      {selectedFile && selectedFile.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile("");
                            setUploadMessage(null);
                          }}
                          className="px-2 py-1.5 text-[11px] font-black text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-xl transition-all flex items-center gap-1 border border-rose-200 shadow-2xs cursor-pointer active:scale-95"
                          title="Hapus / Bersihkan Tautan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Hapus</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handlePasteClick}
                        className="px-2.5 py-1.5 text-[11px] font-black text-slate-800 hover:text-slate-900 bg-slate-200/90 hover:bg-slate-300 rounded-xl transition-all flex items-center gap-1 border border-slate-300 shadow-2xs cursor-pointer active:scale-95"
                        title="Tempel Link dari Clipboard (Paste)"
                      >
                        <Clipboard className="w-3.5 h-3.5 text-slate-700" />
                        <span>Paste</span>
                      </button>
                    </div>
                  </div>

                  {/* Real-time Link Access Indicator */}
                  {isCheckingDriveAccess && (
                    <div className="p-3 bg-slate-100 rounded-2xl text-[10px] font-extrabold text-slate-600 flex items-center gap-2 animate-pulse border border-slate-200">
                      <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-transparent rounded-full animate-spin shrink-0" />
                      <span>Mendeteksi tautan &amp; hak akses berkas... Memastikan link dapat dibuka guru.</span>
                    </div>
                  )}

                  {/* Link Access Status Result */}
                  {!isCheckingDriveAccess && driveAccessResult && (
                    <>
                      {driveAccessResult.isDrive && driveAccessResult.accessible === false ? (
                        <div className="p-3.5 bg-rose-50/95 border-2 border-rose-400 rounded-2xl space-y-2.5 animate-in fade-in duration-300 shadow-sm">
                          <div className="flex items-center justify-between gap-2 border-b border-rose-200/80 pb-2">
                            <div className="flex items-center gap-1.5 text-rose-900 font-black text-xs uppercase tracking-tight">
                              <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0 animate-bounce" />
                              <span>🚫 HAK AKSES GOOGLE DRIVE DIBATASI (DIKUNCI)</span>
                            </div>
                            <span className="px-2 py-0.5 bg-rose-200 text-rose-950 rounded-md text-[9px] font-black uppercase tracking-wider shrink-0">
                              Akses Ditolak
                            </span>
                          </div>
                          <p className="text-[10.5px] text-rose-950 font-bold leading-relaxed">
                            Aplikasi mendeteksi link ini masih berstatus <strong className="underline decoration-rose-500 font-black text-rose-900">&quot;Dibatasi (Restricted)&quot;</strong>. Jika Anda mengirimkan link ini, <strong className="text-rose-950 font-black">Pak Agan tidak dapat membuka atau menilai tugas Anda (akan langsung ditolak)</strong>.
                          </p>
                          <div className="bg-white/90 p-3 rounded-xl border border-rose-200 space-y-1.5 text-[10px] text-slate-800 shadow-xs">
                            <p className="font-black text-rose-700 uppercase tracking-wide">💡 LAKUKAN HAL INI DI GOOGLE DRIVE ANDA:</p>
                            <ol className="list-decimal list-inside space-y-1 font-bold text-slate-700 leading-normal">
                              <li>Buka file tugas di aplikasi atau web <strong className="text-slate-900">Google Drive</strong>.</li>
                              <li>Klik kanan file &rarr; pilih <strong className="text-slate-900">&quot;Bagikan&quot; (Share)</strong>.</li>
                              <li>Ubah Akses Umum menjadi <strong className="text-emerald-700 font-black">&quot;Siapa saja yang memiliki link&quot;</strong>.</li>
                              <li>Salin ulang link tersebut lalu tempelkan kembali di atas.</li>
                            </ol>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-center justify-between gap-2.5 animate-in fade-in duration-300 shadow-xs">
                          <div className="flex items-start gap-2.5">
                            <CheckCircle className="w-4.5 h-4.5 text-emerald-600 shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <p className="font-black text-[11px] uppercase tracking-wider text-emerald-950">
                                ✅ LINK TUGAS VALID &amp; DAPAT DIAKSES GURU
                              </p>
                              <p className="text-[10px] text-emerald-800 font-bold leading-tight">
                                Tautan siap dinilai dan diperiksa oleh guru.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Live Embed Preview if applicable */}
                  {(() => {
                    const previewUrl = getPreviewEmbedUrl(selectedFile);
                    if (!previewUrl) return null;
                    return (
                      <div className="space-y-2 border-2 border-slate-200 bg-slate-50/80 rounded-2xl p-3 animate-in fade-in duration-300">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                          <span className="text-[10px] font-black uppercase text-slate-700 flex items-center gap-1.5">
                            <Eye className="w-3.5 h-3.5 text-emerald-600" /> Pratinjau Tautan (Live Preview)
                          </span>
                          <a
                            href={selectedFile.trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-1"
                          >
                            Buka di Tab Baru ↗
                          </a>
                        </div>
                        <div className="w-full h-48 bg-white rounded-xl overflow-hidden border border-slate-200 shadow-inner">
                          <iframe
                            src={previewUrl}
                            title="Pratinjau Berkas"
                            className="w-full h-full border-0"
                            allow="autoplay"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="p-4 px-6 border-t border-slate-100 bg-slate-50/80 grid grid-cols-2 gap-3 shrink-0">
              <button
                type="button"
                disabled={isUploading || isProcessingScan}
                onClick={() => {
                  setIsUploading(false);
                  setIsUploadModalOpen(false);
                  setUploadProgress(0);
                  setScannedPages([]);
                  setSelectedFile("");
                }}
                className="h-12 rounded-xl bg-slate-200 hover:bg-slate-300 border border-slate-300 font-black text-xs text-slate-700 uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>

              {/* Submit Button handles both PDF Scan mode and Link mode */}
              <button
                type="button"
                disabled={isUploading || isProcessingScan}
                onClick={async () => {
                  if (submissionTab === "scan") {
                    if (scannedPages.length === 0) {
                      setUploadMessage({
                        text: "Harap ambil foto / pindai minimal 1 lembar catatan tugas terlebih dahulu.",
                        type: "error",
                      });
                      return;
                    }
                    if (!selectedTugas) return;

                    setIsUploading(true);
                    setUploadProgress(20);
                    setUploadMessage({ text: "Mengonversi seluruh lembar catatan menjadi 1 file PDF...", type: "warning" });

                    try {
                      // Generate multi-page PDF using jsPDF
                      const pdfDoc = new jsPDF({
                        orientation: "portrait",
                        unit: "mm",
                        format: "a4",
                      });

                      const pageWidth = 210;
                      const pageHeight = 297;
                      const margin = 10;
                      const maxW = pageWidth - margin * 2;
                      const maxH = pageHeight - margin * 2;

                      for (let i = 0; i < scannedPages.length; i++) {
                        if (i > 0) {
                          pdfDoc.addPage();
                        }
                        const imgData = scannedPages[i];
                        await new Promise<void>((resolve) => {
                          const img = new Image();
                          img.onload = () => {
                            let renderW = maxW;
                            let renderH = (img.height * renderW) / img.width;
                            if (renderH > maxH) {
                              renderH = maxH;
                              renderW = (img.width * renderH) / img.height;
                            }
                            const posX = margin + (maxW - renderW) / 2;
                            const posY = margin + (maxH - renderH) / 2;
                            pdfDoc.addImage(imgData, "JPEG", posX, posY, renderW, renderH, undefined, "FAST");
                            pdfDoc.setFontSize(9);
                            pdfDoc.setTextColor(120, 120, 120);
                            pdfDoc.text(
                              `Halaman ${i + 1} dari ${scannedPages.length} • Catatan Tugas Siswa: ${selectedTugas.materi || "Tugas"} • SiPinter Apps`,
                              pageWidth / 2,
                              pageHeight - 5,
                              { align: "center" }
                            );
                            resolve();
                          };
                          img.onerror = () => resolve();
                          img.src = imgData;
                        });
                      }

                      setUploadProgress(65);
                      setUploadMessage({ text: "Menyimpan berkas PDF ke database...", type: "warning" });

                      const pdfDataUri = pdfDoc.output("datauristring");
                      const submissionId = `SUB-${student.nisn}-${selectedTugas.id}`;
                      const existingSub = submissionsList.find((s: any) => s.id === submissionId);
                      const initialSubmittedAt = existingSub?.submittedAt || existingSub?.createdAt || new Date().toISOString();
                      const nowIso = new Date().toISOString();
                      const isPerbaikan = !!existingSub && (existingSub.status === "ditolak" || existingSub.wasRejected === true || !!existingSub.keterangan);

                      const cleanName = (student.name || student.displayName || "Siswa").replace(/[^a-zA-Z0-9]/g, "_");
                      const newSubmissionObj = {
                        id: submissionId,
                        assignmentId: selectedTugas.id,
                        nisn: student.nisn,
                        studentName: student.name || student.displayName || "Siswa",
                        kelas: student.kelas || null,
                        fileName: `Catatan_${cleanName}_${scannedPages.length}Lembar.pdf`,
                        fileUrl: pdfDataUri,
                        pageCount: scannedPages.length,
                        isPdfScan: true,
                        submittedAt: initialSubmittedAt,
                        updatedAt: nowIso,
                        resubmittedAt: isPerbaikan ? nowIso : null,
                        wasRejected: isPerbaikan || existingSub?.wasRejected || false,
                        status: "menunggu penilaian guru",
                      };

                      try {
                        mutateSubmissions([...submissionsList.filter((s: any) => s.id !== submissionId), newSubmissionObj], false);
                      } catch (e) {
                        console.warn("Optimistic update error:", e);
                      }

                      await setDoc(
                        doc(db, "submissions", submissionId),
                        newSubmissionObj,
                        { merge: true },
                      );

                      setSuccessTugasMateri(selectedTugas?.materi || "Materi Pelajaran");
                      setUploadProgress(100);
                      trackUsage(0, 1);
                      mutateSubmissions();

                      setIsUploadModalOpen(false);
                      setShowSuccessOverlay(true);
                      setScannedPages([]);
                      setUploadMessage(null);
                      setUploadProgress(0);
                      setSelectedFile("");
                    } catch (error: any) {
                      console.warn("Gagal mengirim berkas PDF:", error);
                      setUploadMessage({
                        text: error?.message || "Terjadi kesalahan saat mengonversi dan mengunggah dokumen PDF.",
                        type: "error",
                      });
                    } finally {
                      setIsUploading(false);
                    }
                  } else {
                    // Link submission mode
                    if (!selectedFile || !selectedFile.trim()) {
                      setUploadMessage({
                        text: "Tolong isi/tempel dulu link Google Drive tugas yang akan dikirim",
                        type: "error",
                      });
                      return;
                    }
                    if (!selectedTugas) return;
                    if (!selectedFile.trim().startsWith("http://") && !selectedFile.trim().startsWith("https://")) {
                      setUploadMessage({
                        text: "Tautan tidak valid! Harap masukkan link yang benar (dimulai dengan https://).",
                        type: "error",
                      });
                      return;
                    }

                    setIsUploading(true);
                    setUploadProgress(25);
                    setUploadMessage({ text: "Memeriksa izin tautan...", type: "warning" });

                    try {
                      const link = selectedFile.trim();
                      if (/drive\.google\.com|docs\.google\.com/i.test(link)) {
                        try {
                          const checkRes = await fetchWithRetry("/api/check-drive-access", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: link }),
                          });
                          const checkData = await checkRes.json();
                          if (checkData.isDrive && checkData.accessible === false) {
                            setIsUploading(false);
                            setUploadProgress(0);
                            setUploadMessage({
                              text: "🚫 PENGUMPULAN DITOLAK: Link Google Drive masih DIBATASI (Restricted). Ubah ke 'Siapa saja yang memiliki link'.",
                              type: "error",
                            });
                            return;
                          }
                        } catch (checkErr) {
                          console.warn("Skipped drive access check:", checkErr);
                        }
                      }

                      setUploadProgress(60);
                      setUploadMessage({ text: "Menyimpan ke database...", type: "success" });

                      const submissionId = `SUB-${student.nisn}-${selectedTugas.id}`;
                      const existingSub = submissionsList.find((s: any) => s.id === submissionId);
                      const initialSubmittedAt = existingSub?.submittedAt || existingSub?.createdAt || new Date().toISOString();
                      const nowIso = new Date().toISOString();
                      const isPerbaikan = !!existingSub && (existingSub.status === "ditolak" || existingSub.wasRejected === true || !!existingSub.keterangan);

                      const newSubmissionObj = {
                        id: submissionId,
                        assignmentId: selectedTugas.id,
                        nisn: student.nisn,
                        studentName: student.name || student.displayName || "Siswa",
                        kelas: student.kelas || null,
                        fileUrl: link,
                        submittedAt: initialSubmittedAt,
                        updatedAt: nowIso,
                        resubmittedAt: isPerbaikan ? nowIso : null,
                        wasRejected: isPerbaikan || existingSub?.wasRejected || false,
                        status: "menunggu penilaian guru",
                      };

                      try {
                        mutateSubmissions([...submissionsList.filter((s: any) => s.id !== submissionId), newSubmissionObj], false);
                      } catch (err) {
                        console.warn("Optimistic update error:", err);
                      }

                      await setDoc(
                        doc(db, "submissions", submissionId),
                        newSubmissionObj,
                        { merge: true },
                      );

                      setSuccessTugasMateri(selectedTugas?.materi || "Materi Pelajaran");
                      setUploadProgress(100);
                      trackUsage(0, 1);
                      mutateSubmissions();

                      setIsUploadModalOpen(false);
                      setShowSuccessOverlay(true);
                      setUploadMessage(null);
                      setUploadProgress(0);
                      setSelectedFile("");
                    } catch (error: any) {
                      console.warn("Gagal mengirim tugas:", error);
                      setUploadMessage({
                        text: error.message || "Terjadi kesalahan saat mengumpulkan tugas.",
                        type: "error",
                      });
                    } finally {
                      setIsUploading(false);
                    }
                  }
                }}
                className="h-12 rounded-xl bg-slate-950 hover:bg-[#85cc00] hover:text-slate-950 text-white font-black text-xs uppercase tracking-wider active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-black/10 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>
                  {submissionTab === "scan"
                    ? `Kirim ${scannedPages.length > 0 ? `(${scannedPages.length} Lembar PDF)` : "Tugas PDF"}`
                    : "Kirim Tautan Tugas"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full Image Preview Modal for Scanned Page */}
      {previewModalIndex !== null && scannedPages[previewModalIndex] && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="relative max-w-2xl max-h-[90vh] bg-slate-900 rounded-3xl overflow-hidden shadow-2xl flex flex-col p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 text-white">
              <span className="text-xs font-black uppercase tracking-wider">
                Pratinjau Lembar {previewModalIndex + 1} dari {scannedPages.length}
              </span>
              <button
                type="button"
                onClick={() => setPreviewModalIndex(null)}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 flex items-center justify-center">
              <img
                src={scannedPages[previewModalIndex]}
                alt={`Pratinjau Lembar ${previewModalIndex + 1}`}
                className="max-h-[70vh] object-contain rounded-xl shadow-lg"
              />
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                disabled={previewModalIndex === 0}
                onClick={() => setPreviewModalIndex(previewModalIndex - 1)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                &larr; Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRemoveScannedPage(previewModalIndex);
                }}
                className="px-3 py-1.5 bg-rose-600/30 hover:bg-rose-600 text-rose-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Lembar Ini</span>
              </button>
              <button
                type="button"
                disabled={previewModalIndex === scannedPages.length - 1}
                onClick={() => setPreviewModalIndex(previewModalIndex + 1)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold disabled:opacity-40 cursor-pointer"
              >
                Berikutnya &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drive Auth Notice Modal */}
      {showDriveAuthNotice && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-md"
            onClick={() => setShowDriveAuthNotice(false)}
          ></div>
          <div className="relative w-full max-w-md bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200/80 z-10 p-8 text-center animate-in zoom-in-95 duration-300">
            {/* Elegant Icon Header */}
            <div className="mx-auto w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-6 border border-blue-100 shadow-inner">
              <Link className="w-8 h-8 animate-pulse text-[#85cc00]" />
            </div>

            {/* Title */}
            <h3 className="font-display font-black text-lg text-slate-900 uppercase tracking-wider mb-2">
              Hubungkan Google Drive
            </h3>
            
            {/* Subtitle / Description */}
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">
              Sistem Pengumpulan Tugas Sekolah
            </p>

            <div className="text-xs font-medium text-slate-600 leading-relaxed mb-6 space-y-3">
              <p>
                Untuk dapat mengirimkan berkas tugas sekolah Anda langsung ke folder Guru, Anda perlu menghubungkan aplikasi ini dengan akun Google Drive Anda terlebih dahulu.
              </p>
              <div className="p-3.5 rounded-2xl bg-amber-50/50 border border-amber-100 text-left flex items-start gap-3">
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] leading-relaxed text-amber-800 font-bold uppercase tracking-wider">
                  Sangat Aman: File Anda akan tersimpan di akun Google Drive Anda sendiri dan tautannya akan dikirim otomatis ke sistem Guru.
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={async () => {
                  setShowDriveAuthNotice(false);
                  try {
                    const res = await googleSignIn();
                    if (res && res.accessToken) {
                      setNeedsDriveAuth(false);
                      setShowDriveSuccessConnected(true);
                    }
                  } catch (err) {
                    console.warn("Gagal menghubungkan:", err);
                  }
                }}
                className="w-full h-12 rounded-2xl bg-[#85cc00] hover:brightness-110 text-slate-900 font-black text-xs uppercase tracking-widest shadow-lg shadow-[#85cc00]/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer border border-transparent"
              >
                <Link className="w-4 h-4" />
                Hubungkan Sekarang
              </button>
              
              <button
                type="button"
                onClick={() => {
                  setShowDriveAuthNotice(false);
                }}
                className="w-full h-12 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center cursor-pointer border border-slate-200"
              >
                Nanti Saja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drive Auth Success Modal */}
      {showDriveSuccessConnected && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-md"
            onClick={() => setShowDriveSuccessConnected(false)}
          ></div>
          <div className="relative w-full max-w-md bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200/80 z-10 p-8 text-center animate-in zoom-in-95 duration-300">
            {/* Elegant Checkmark Header with Pulse */}
            <div className="mx-auto w-16 h-16 bg-[#85cc00]/10 text-[#85cc00] rounded-full flex items-center justify-center mb-6 border border-[#85cc00]/20 shadow-inner">
              <CheckCircle2 className="w-8 h-8 text-[#85cc00] animate-bounce" />
            </div>

            {/* Title */}
            <h3 className="font-display font-black text-lg text-slate-900 uppercase tracking-wider mb-2">
              Drive Berhasil Terhubung
            </h3>
            
            {/* Subtitle / Description */}
            <p className="text-[10px] font-black text-[#85cc00] uppercase tracking-widest mb-6">
              Google Drive Terkoneksi
            </p>

            <div className="text-xs font-medium text-slate-600 leading-relaxed mb-6 space-y-3">
              <p>
                Selamat! Akun Google Drive Anda telah berhasil terhubung dengan sistem pengumpulan tugas sekolah. 
              </p>
              <p>
                Kini Anda dapat langsung memilih file atau memotret lembar tugas dari perangkat, dan sistem akan mengunggahnya secara otomatis ke folder aman Anda.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowDriveSuccessConnected(false);
                  if (selectedTugas) {
                    setIsUploadModalOpen(true);
                  }
                }}
                className="w-full h-12 rounded-2xl bg-[#85cc00] hover:brightness-110 text-slate-900 font-black text-xs uppercase tracking-widest shadow-lg shadow-[#85cc00]/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer border border-transparent"
              >
                {selectedTugas ? "Lanjutkan Kumpulkan Tugas" : "Selesai"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JSON Response Error Explanation Modal */}
      {showJSONErrorExplain && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-md"
            onClick={() => setShowJSONErrorExplain(false)}
          ></div>
          <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200/80 z-10 p-8 animate-in zoom-in-95 duration-300">
            {/* Header Icon */}
            <div className="mx-auto w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mb-5 border border-rose-100 shadow-inner">
              <AlertTriangle className="w-8 h-8 text-rose-600 animate-pulse" />
            </div>

            {/* Title */}
            <h3 className="font-display font-black text-lg text-slate-900 uppercase tracking-wider text-center mb-1">
              Panduan Mengatasi Kendala
            </h3>
            
            {/* Subtitle / Error code */}
            <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest text-center mb-6">
              RESPON SERVER TIDAK VALID (NON-JSON ERROR)
            </p>

            {/* Explanations */}
            <div className="space-y-4 mb-6">
              <p className="text-xs font-semibold text-slate-600 text-center leading-relaxed">
                Sistem tidak dapat memproses berkas Anda karena server mengirimkan respon berupa halaman web biasa, bukan format data terstruktur (JSON). Jangan khawatir, hal ini biasanya disebabkan oleh salah satu hal berikut:
              </p>

              <div className="space-y-3 max-h-[260px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-slate-200">
                {/* Cause 1: File Size */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex gap-3 items-start">
                  <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg shrink-0 mt-0.5 animate-pulse">
                    <Info className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">
                      1. Ukuran Berkas Terlalu Besar (Maks 10MB)
                    </h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                      Foto tugas dari kamera HP langsung biasanya memiliki resolusi tinggi dan berukuran sangat besar (10MB+).
                    </p>
                    <p className="text-[10px] text-amber-600 font-bold uppercase tracking-wider mt-1.5">
                      💡 SOLUSI: Kompres foto, ubah resolusi ke sedang, atau konversi berkas Anda ke PDF sebelum mengunggah kembali.
                    </p>
                  </div>
                </div>

                {/* Cause 2: Connection / Timeout */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex gap-3 items-start">
                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg shrink-0 mt-0.5">
                    <RefreshCw className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">
                      2. Gangguan Koneksi Internet (Timeout)
                    </h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                      Koneksi internet Anda sempat terputus secara tidak terduga di tengah jalan saat proses mengirim berkas ke Google Drive.
                    </p>
                    <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider mt-1.5">
                      💡 SOLUSI: Pastikan sinyal internet Anda kuat dan stabil, lalu coba kirimkan kembali berkas Anda.
                    </p>
                  </div>
                </div>

                {/* Cause 3: Server Busy */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex gap-3 items-start">
                  <div className="p-1.5 bg-rose-100 text-rose-700 rounded-lg shrink-0 mt-0.5">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide mb-1">
                      3. Server Mengalami Antrean Padat
                    </h4>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                      Banyak rekan-rekan siswa lainnya sedang mengumpulkan tugas secara bersamaan, sehingga antrean pengunggahan ke server sangat padat.
                    </p>
                    <p className="text-[10px] text-rose-600 font-bold uppercase tracking-wider mt-1.5">
                      💡 SOLUSI: Tunggu sekitar 1 hingga 2 menit, kemudian silakan klik tombol Kumpulkan kembali.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowJSONErrorExplain(false);
                }}
                className="w-full h-12 rounded-2xl bg-[#85cc00] hover:brightness-110 text-slate-900 font-black text-xs uppercase tracking-widest shadow-lg shadow-[#85cc00]/20 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer border border-transparent"
              >
                Coba Unggah Kembali
              </button>
              
              <button
                type="button"
                onClick={() => setShowJSONErrorExplain(false)}
                className="w-full h-12 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-500 font-black text-xs uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center cursor-pointer border border-slate-200"
              >
                Mengerti & Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Viewing Feedback Modal (Lihat Hasil) */}
      {viewingTugas && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-md"
            onClick={() => setViewingTugas(null)}
          ></div>
          <div className={`relative w-full bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 z-10 mx-4 animate-in zoom-in-95 duration-300 flex flex-col ${isFullscreenTugasModal ? 'max-w-[95vw] h-[95vh]' : 'max-w-lg max-h-[90vh]'}`}>
            {/* Header */}
            <div className="bg-white p-6 px-8 flex justify-between items-center shrink-0 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-display font-black text-xs uppercase tracking-widest text-slate-900">
                    DETAIL EVALUASI TUGAS
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    SISTEM EVALUASI SISWA DIGITAL
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsFullscreenTugasModal(!isFullscreenTugasModal)}
                  className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-blue-600 flex items-center justify-center transition-all cursor-pointer"
                  title="Perbesar / Perkecil"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewingTugas(null);
                    setIsFullscreenTugasModal(false);
                  }}
                  className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 sm:p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
              <div className="text-center space-y-1">
                <div className="w-10 h-10 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-center mx-auto text-blue-600">
                  <Award className="w-5 h-5" />
                </div>
                <h5 className="font-display font-black text-sm text-slate-900 leading-tight">
                  {viewingTugas.title}
                </h5>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                  {viewingTugas.bab}
                </p>
              </div>

              {/* Evaluation Info */}
              <div className={`p-4 rounded-2xl border ${
                viewingTugas.submission?.nilai 
                  ? "bg-slate-50 border-slate-100" 
                  : "bg-amber-50/50 border-amber-100"
              }`}>
                {viewingTugas.submission?.nilai ? (
                  /* Graded View - Compact Score */
                  <div className="flex items-center gap-5">
                    <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                      <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                        <circle cx="50" cy="50" r="40" fill="transparent" stroke="#e2e8f0" strokeWidth="10" />
                        <circle 
                          cx="50" cy="50" r="40" 
                          fill="transparent" 
                          stroke="#10b981" 
                          strokeWidth="10" 
                          strokeDasharray="251.2" 
                          strokeDashoffset={251.2 - (251.2 * Number(viewingTugas.submission.nilai)) / 100} 
                          strokeLinecap="round" 
                          className="transition-all duration-1000 ease-out" 
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-black bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-600 bg-clip-text text-transparent animate-pulse">
                          {viewingTugas.submission.nilai}
                        </span>
                        <span className="text-[7px] text-slate-400 font-bold uppercase">Skor</span>
                      </div>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status</span>
                          <span className="px-2 py-0.5 text-[9px] font-black rounded-md bg-emerald-50 text-emerald-700 border border-emerald-100">
                            Sudah Dinilai
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Waktu</span>
                          <span className="text-[10px] font-bold text-slate-600">
                            {new Date(viewingTugas.submission.submittedAt).toLocaleDateString("id-ID", { day: 'numeric', month: 'short' })} • {new Date(viewingTugas.submission.submittedAt).toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Ungraded View - Very Compact */
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Status Evaluasi</span>
                      {viewingTugas.submission?.status === "ditolak" ? (
                        <span className="px-2.5 py-0.5 bg-rose-100 text-rose-700 text-[9px] font-black rounded-md uppercase tracking-wider border border-rose-200">
                          Ditolak ❌
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-amber-100 text-amber-700 text-[9px] font-black rounded-md uppercase tracking-wider border border-amber-200">
                          Menunggu Penilaian
                        </span>
                      )}
                    </div>
                    <div className="h-px bg-amber-200/20 w-full" />
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Waktu Kirim</span>
                      <span className="text-[10px] font-bold text-slate-700">
                        {viewingTugas.submission?.submittedAt ? (
                          new Date(viewingTugas.submission.submittedAt).toLocaleDateString("id-ID", { 
                            day: 'numeric', 
                            month: 'short'
                          }) + " • " + new Date(viewingTugas.submission.submittedAt).toLocaleTimeString("id-ID", { hour: '2-digit', minute: '2-digit' })
                        ) : "-"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Feedback Section - Show only if rejected as per request */}
              {viewingTugas.submission?.status === "ditolak" && (viewingTugas.submission?.keterangan || viewingTugas.submission?.feedback) && (
                <div className="p-5 rounded-3xl space-y-2 bg-rose-50/50 border border-rose-100">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-rose-500" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-rose-800">
                      Catatan Guru (Alasan Penolakan)
                    </span>
                  </div>
                  <p className="text-xs font-medium text-slate-600 leading-relaxed italic">
                    &ldquo;{viewingTugas.submission.keterangan || viewingTugas.submission.feedback}&rdquo;
                  </p>
                </div>
              )}

              {/* Task Link from Teacher */}
              {(viewingTugas.taskLink || viewingTugas.linkTugas || viewingTugas.fileUrl) && (
                <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-[9px] font-black text-emerald-800 uppercase tracking-widest block mb-0.5">
                      File / Link Tugas Dari Guru
                    </span>
                    <p className="text-xs font-bold text-emerald-950 truncate">
                      {viewingTugas.taskLink || viewingTugas.linkTugas || viewingTugas.fileUrl}
                    </p>
                  </div>
                  <a
                    href={(viewingTugas.taskLink || viewingTugas.linkTugas || viewingTugas.fileUrl).startsWith("http") ? (viewingTugas.taskLink || viewingTugas.linkTugas || viewingTugas.fileUrl) : `https://${viewingTugas.taskLink || viewingTugas.linkTugas || viewingTugas.fileUrl}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => handleOpenFileLink(viewingTugas.taskLink || viewingTugas.linkTugas || viewingTugas.fileUrl, e)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1 shadow-xs cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Buka Link ↗</span>
                  </a>
                </div>
              )}

              {/* Submitted File Info with Live Preview */}
              {viewingTugas.submission?.fileUrl && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      File / Link Tugas yang Dikumpulkan
                    </span>
                    <a 
                      href={viewingTugas.submission.fileUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      onClick={(e) => handleOpenFileLink(viewingTugas.submission.fileUrl, e)}
                      className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl text-[10px] font-bold transition-all flex items-center gap-1 border border-blue-100 cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Buka Tautan Utama ↗
                    </a>
                  </div>

                  {(() => {
                    const previewUrl = getPreviewEmbedUrl(viewingTugas.submission.fileUrl);
                    if (!previewUrl) return null;

                    return (
                      <div className="w-full h-60 bg-slate-100 rounded-2xl overflow-hidden border border-slate-200 shadow-inner relative">
                        <iframe
                          src={previewUrl}
                          title="Pratinjau Berkas Terkumpul"
                          className="w-full h-full border-0"
                          allow="autoplay"
                        />
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-center gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setViewingTugas(null)}
                  className={`h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 font-extrabold text-xs text-slate-700 uppercase tracking-widest active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer ${viewingTugas.submission?.nilai ? "w-full" : "w-32"}`}
                >
                  Tutup
                </button>
                {!viewingTugas.submission?.nilai && (
                  <button
                    type="button"
                    onClick={() => {
                      const task = viewingTugas;
                      setViewingTugas(null);
                      setSelectedTugas(task);
                      if (task.submission?.fileUrl) {
                        setSelectedFile(task.submission.fileUrl);
                      } else {
                        setSelectedFile("");
                      }
                      setIsUploadModalOpen(true);
                    }}
                    className="h-12 rounded-2xl px-6 bg-blue-600 hover:bg-sky-600 text-white font-extrabold text-xs uppercase tracking-widest shadow-lg shadow-blue-500/20 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer border border-transparent"
                  >
                    {viewingTugas.submission ? "Kumpulkan Ulang" : "Kumpulkan"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Guide / Panduan Tugas Modal */}
      {isGuideModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-md"
            onClick={() => setIsGuideModalOpen(false)}
          ></div>
          <div className="relative w-full max-w-md bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 z-10 mx-4 animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="bg-white p-6 px-8 flex justify-between items-center shrink-0 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                  <Lightbulb className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-display font-black text-xs uppercase tracking-widest text-slate-900">
                    PANDUAN TUGAS DIGITAL
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    SISTEM EDUKASI DIGITAL
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsGuideModalOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-8 sm:p-10 space-y-6">
              {(() => {
                const guides = [
                  {
                    title: "Pengumpulan Berkas via Tautan Digital",
                    desc: "Tugas dapat dikumpulkan berupa Tautan / Link publik dari Google Drive, CamScanner, Canva, OneDrive, Dropbox, atau Link Web dokumen PDF/foto. Cukup salin tautan berbagi dan tempelkan ke kolom tugas.",
                    icon: ShieldCheck
                  },
                  {
                    title: "Atur Hak Akses Berbagi Publik (PENTING)",
                    desc: "Sebelum menyalin tautan, pastikan izin berbagi disetel ke 'Siapa saja yang memiliki link dapat melihat' (Anyone with link). Jika dikunci/dibatasi, Pak Agan tidak bisa membaca atau menilai tugas Anda!",
                    icon: FileText
                  },
                  {
                    title: "Cara Salin Tautan yang Benar",
                    desc: "Gunakan tombol 'Salin Link' / 'Bagikan' di Google Drive, CamScanner, Canva, atau cloud storage Anda. Tempelkan (paste) langsung ke dalam kolom pengumpulan.",
                    icon: Link
                  },
                  {
                    title: "Pantau Status Penilaian",
                    desc: "Setelah tautan dikirim, status tugas akan otomatis berubah menjadi 'Menunggu Penilaian'. Anda dapat memantau perolehan nilai, masukan guru, atau instruksi kumpul ulang langsung dari dashboard ini.",
                    icon: Clock
                  }
                ];
                
                const currentGuide = guides[currentTipIdx];
                const GuideIcon = currentGuide.icon;
                
                return (
                  <div className="space-y-6 text-center">
                    <div className="w-16 h-16 bg-blue-50 border border-blue-100 rounded-3xl flex items-center justify-center mx-auto text-blue-600">
                      <GuideIcon className="w-8 h-8" />
                    </div>
                    <div className="space-y-2">
                      <h5 className="font-display font-black text-lg text-slate-900">
                        {currentGuide.title}
                      </h5>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
                        Langkah {currentTipIdx + 1} dari {guides.length}
                      </p>
                      <p className="text-sm font-medium text-slate-600 leading-relaxed max-w-sm mx-auto">
                        {currentGuide.desc}
                      </p>
                    </div>

                    {/* Step indicator dots */}
                    <div className="flex justify-center gap-1.5">
                      {guides.map((_, i) => (
                        <span 
                          key={`guide-nav-indicator-${i}`} 
                          onClick={() => setCurrentTipIdx(i)}
                          className={`w-2.5 h-2.5 rounded-full cursor-pointer transition-all ${i === currentTipIdx ? "bg-blue-600 w-6" : "bg-slate-200"}`}
                        ></span>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="grid grid-cols-2 gap-4 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (currentTipIdx > 0) {
                            setCurrentTipIdx(currentTipIdx - 1);
                          } else {
                            setIsGuideModalOpen(false);
                          }
                        }}
                        className="h-12 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 font-extrabold text-xs text-slate-700 uppercase tracking-widest active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer"
                      >
                        {currentTipIdx === 0 ? "Batal" : "Sebelumnya"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (currentTipIdx < guides.length - 1) {
                            setCurrentTipIdx(currentTipIdx + 1);
                          } else {
                            setIsGuideModalOpen(false);
                          }
                        }}
                        className="h-12 rounded-2xl bg-blue-600 hover:bg-sky-600 text-white font-extrabold text-xs uppercase tracking-widest shadow-lg shadow-blue-500/20 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer border border-transparent"
                      >
                        {currentTipIdx === guides.length - 1 ? "Selesai" : "Selanjutnya"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Elegant & Professional Floating Success Overlay with Backdrop Blur */}
      <AnimatePresence>
        {showSuccessOverlay && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            {/* Backdrop Blur overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-md"
              onClick={() => setShowSuccessOverlay(false)}
            />
            
            {/* Elegant Floating Dialog box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="relative w-full max-w-sm bg-white/95 backdrop-blur-md rounded-[2.5rem] overflow-hidden shadow-[0_25px_60px_-15px_rgba(0,0,0,0.2)] border border-white/20 z-10 mx-4 animate-in duration-300"
            >
              {/* Pattern Header Accent */}
              <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-emerald-400 via-[#85cc00] to-teal-400"></div>

              <div className="p-8 flex flex-col items-center text-center">
                {/* Elegant 3D-like Glowing Checked Circle Icon Container */}
                <div className="relative mb-6">
                  {/* Outer glowing pulsing aura */}
                  <div className="absolute inset-0 bg-[#85cc00]/20 rounded-full blur-xl scale-125"></div>
                  
                  {/* Central premium circle */}
                  <div className="relative w-20 h-20 bg-gradient-to-br from-white to-slate-50 border-4 border-white shadow-xl rounded-full flex items-center justify-center text-[#85cc00]">
                    <CheckCircle className="w-10 h-10" />
                  </div>
                </div>

                {/* Sparkling accent */}
                <div className="flex items-center gap-1.5 mb-1.5 bg-[#85cc00]/10 text-[#6ea800] px-3 py-1 rounded-full">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-black uppercase tracking-wider">BERHASIL DIKIRIM</span>
                </div>

                {/* Typography */}
                <h3 className="font-display font-black text-xl text-slate-900 tracking-tight leading-tight mb-2">
                  Tugas Anda Diterima!
                </h3>
                
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
                  SISTEM PEMBELAJARAN DIGITAL
                </p>

                {/* Task Details Box - Clean Glassmorphism style */}
                <div className="w-full bg-slate-50/80 border border-slate-100 rounded-2xl p-4 mb-6 text-left space-y-3 shadow-inner">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Materi Tugas</span>
                    <span className="text-xs font-extrabold text-slate-800 line-clamp-2 leading-snug">
                      {successTugasMateri}
                    </span>
                  </div>
                  
                  <div className="h-px bg-slate-100"></div>
                  
                  <div className="flex justify-between items-center">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Metode Pengiriman</span>
                      <span className="text-xs font-bold text-slate-700">Link Google Drive</span>
                    </div>
                    <div className="flex flex-col text-right">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">Status</span>
                      <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        MENUNGGU PENILAIAN
                      </span>
                    </div>
                  </div>
                </div>

                {/* Soft encouraging message */}
                <p className="text-xs font-medium text-slate-500 leading-relaxed mb-6">
                  Terima kasih! Tautan tugas telah terkirim secara otomatis ke Dashboard Pak Agan. Pastikan link Drive Anda dapat diakses.
                </p>

                {/* Elegant Close Button */}
                <button
                  type="button"
                  onClick={() => setShowSuccessOverlay(false)}
                  className="w-full h-12 rounded-2xl bg-gradient-to-r from-[#85cc00] to-[#74b300] hover:brightness-110 text-slate-900 font-black text-xs uppercase tracking-widest shadow-lg shadow-[#85cc00]/30 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer border border-transparent"
                >
                  <Check className="w-4 h-4" /> Selesai
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Token Modal */}
      {selectedExamForToken && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-100/80 backdrop-blur-md" onClick={() => setSelectedExamForToken(null)}></div>
          <div className="relative w-full max-w-md bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 z-10 mx-4 animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="bg-white p-6 px-8 flex justify-between items-center shrink-0 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-[#85cc00]/10 rounded-xl text-[#85cc00]">
                  <KeyRound className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="font-display font-black text-xs uppercase tracking-widest text-slate-900">
                    VERIFIKASI AKSES CBT
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    OTENTIKASI UJIAN ONLINE
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedExamForToken(null)}
                className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-8 sm:p-10 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center mx-auto text-slate-400">
                  <KeyRound className="w-8 h-8" />
                </div>
                <h5 className="font-display font-black text-lg text-slate-900">
                  Masukkan Token Ujian
                </h5>
                <p className="text-xs font-semibold text-slate-400 leading-relaxed uppercase tracking-wider">
                  UJIAN: {selectedExamForToken.title}
                </p>
                {selectedExamForToken.externalQuizUrl && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[10px] font-bold">
                    <ExternalLink className="w-3 h-3" />
                    Terhubung Dokumen Soal Eksternal (PDF / Notebook LM)
                  </div>
                )}
              </div>

              {examTokenError && (
                <div className="text-center p-3 bg-rose-50 border border-rose-100 rounded-2xl text-rose-600 text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-2 animate-bounce">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {examTokenError}
                </div>
              )}

              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
                  MASUKKAN KODE TOKEN YANG DIBERIKAN GURU PENGAWAS
                </label>
                <input
                  type="text"
                  placeholder="X X X X X X"
                  className="w-full text-center tracking-[0.4em] font-mono rounded-3xl border-4 border-slate-950 bg-white p-6 font-black uppercase text-4xl text-slate-950 focus:border-[#85cc00] focus:ring-8 focus:ring-[#85cc00]/20 outline-none transition-all shadow-lg"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleVerifyExamToken()}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  onClick={() => setSelectedExamForToken(null)}
                  className="h-14 bg-slate-100 hover:bg-slate-200 border border-slate-200 font-extrabold text-xs text-slate-700 uppercase tracking-widest rounded-2xl active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer"
                >
                  Batal
                </button>
                <button
                  onClick={handleVerifyExamToken}
                  className="h-14 bg-[#85cc00] hover:brightness-110 text-slate-900 font-extrabold text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-[#85cc00]/20 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer border border-transparent"
                >
                  Mulai Ujian
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Submit Confirm Modal */}
      {isSubmitConfirmOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-slate-100/80 backdrop-blur-md" onClick={() => setIsSubmitConfirmOpen(false)}></div>
          <div className="relative w-full max-w-md bg-white rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 z-10 mx-4 animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="bg-white p-6 px-8 flex justify-between items-center shrink-0 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
                  <CheckCircle2 className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h4 className="font-display font-black text-xs uppercase tracking-widest text-[#10b981]">
                    KONFIRMASI AKHIR
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    REKAP PROSES EVALUASI
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSubmitConfirmOpen(false)}
                className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-8 sm:p-10 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-16 h-16 bg-emerald-50 border border-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-500 shadow-inner">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h5 className="font-display font-black text-xl text-slate-900">
                  Selesaikan Ujian Sekarang?
                </h5>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest leading-relaxed">
                  VALIDASI DAN KALKULASI JAWABAN
                </p>
              </div>

              {/* Informative recap box */}
              <div className="p-5 bg-emerald-50/50 border border-emerald-100 rounded-3xl text-left space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span className="text-[9px] font-black text-emerald-800 uppercase tracking-wider">Pengecekan Integritas</span>
                </div>
                <p className="text-[12px] font-semibold text-slate-600 leading-relaxed">
                  Apakah Anda yakin ingin mengakhiri sesi pengerjaan ujian? Setelah lembar jawaban dikirim, lembar pengerjaan akan dikunci secara permanen dan nilai Anda akan langsung terkirim secara otomatis.
                </p>
                <div className="text-[10px] bg-white border border-emerald-100/60 p-3 rounded-xl font-mono text-emerald-950">
                  ✓ Seluruh pilihan tersimpan aman<br/>
                  ✓ Skor langsung diukur otomatis<br/>
                  ✓ Riwayat pengerjaan dicatat digital
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-2">
                <button
                  onClick={() => handleFinishExam(false)}
                  className="w-full h-14 bg-[#10b981] hover:bg-[#059669] text-white font-extrabold text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-600/20 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer border border-transparent"
                >
                  Ya, Kumpulkan Jawaban Sekarang
                </button>
                <button
                  onClick={() => setIsSubmitConfirmOpen(false)}
                  className="w-full h-14 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 font-extrabold text-xs uppercase tracking-widest rounded-2xl border border-slate-200 hover:border-slate-300 transition-all text-center flex items-center justify-center cursor-pointer"
                >
                  Belum Selesai, Tinjau Kembali
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unanswered Questions Warning Modal */}
      {unansweredWarningList && unansweredWarningList.length > 0 && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setUnansweredWarningList(null)}></div>
          <div className="relative w-full max-w-md bg-white rounded-[2rem] overflow-hidden shadow-2xl border border-slate-200 z-10 mx-auto max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="bg-rose-50 border-b border-rose-100 p-6 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-rose-500 text-white rounded-xl shadow-lg shadow-rose-500/20">
                  <AlertOctagon className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-sans font-black text-xs uppercase tracking-widest text-rose-700">
                    Lembar Jawaban Belum Lengkap
                  </h4>
                  <p className="text-[10px] text-rose-500 font-bold uppercase tracking-wider">
                    Sistem Deteksi Presisi Ujian
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUnansweredWarningList(null)}
                className="w-8 h-8 rounded-lg bg-white text-rose-500 border border-rose-100 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
              <div className="text-center space-y-1">
                <h5 className="font-sans font-extrabold text-base text-slate-800">
                  Wajib Menyelesaikan Semua Soal
                </h5>
                <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                  Ditemukan <span className="text-rose-600 font-extrabold">{unansweredWarningList.length} soal</span> yang belum dijawab. Selesaikan semua soal terlebih dahulu sebelum mengumpulkan ujian.
                </p>
              </div>

              {/* Grid of unanswered question numbers */}
              <div className="bg-slate-50 p-4.5 rounded-2xl border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center">
                  Klik nomor soal di bawah untuk langsung menjawab:
                </p>
                <div className="grid grid-cols-5 gap-2 max-h-[160px] overflow-y-auto p-1 custom-scrollbar">
                  {unansweredWarningList.map((idx, warnIdx) => (
                    <button
                      key={`unanswered-q-item-${idx}-${warnIdx}`}
                      onClick={() => {
                        setCurrentQuestionIdx(idx);
                        setUnansweredWarningList(null);
                      }}
                      className="w-full aspect-square bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-400 font-mono font-black text-xs rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer flex items-center justify-center"
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-blue-50/50 border border-blue-100/60 rounded-xl flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[10px] font-semibold text-blue-800 leading-relaxed">
                  Tips: Klik salah satu nomor soal di atas untuk langsung menjawab pertanyaan tersebut secara instan.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 bg-slate-50 border-t border-slate-100 flex flex-col gap-2 shrink-0">
              <button
                onClick={() => {
                  if (unansweredWarningList.length > 0) {
                    setCurrentQuestionIdx(unansweredWarningList[0]);
                  }
                  setUnansweredWarningList(null);
                }}
                className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-[10px] uppercase tracking-widest rounded-xl shadow-lg transition-all text-center flex items-center justify-center cursor-pointer"
              >
                Lengkapi Soal Pertama Yang Belum Terjawab
              </button>
              <button
                onClick={() => setUnansweredWarningList(null)}
                className="w-full h-10 bg-white hover:bg-slate-100 text-slate-500 hover:text-slate-700 font-extrabold text-[10px] uppercase tracking-widest rounded-xl border border-slate-200 transition-all text-center flex items-center justify-center cursor-pointer"
              >
                Tutup Peringatan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Violation Overlay */}
      <AnimatePresence>
        {isViolationSirening && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-8 bg-black pointer-events-auto"
          >
             <motion.div 
               animate={{ scale: [1, 1.1, 1], opacity: [0.8, 1, 0.8] }}
               transition={{ duration: 0.3, repeat: Infinity }}
               className="text-center"
             >
                <div className="w-48 h-48 mx-auto mb-8 bg-rose-600 rounded-full flex items-center justify-center shadow-2xl">
                  <AlertOctagon className="w-24 h-24 text-white" />
                </div>
                <h1 className="text-5xl md:text-7xl font-display font-black text-rose-500 uppercase tracking-tighter mb-4 shadow-rose-900 drop-shadow-2xl">
                  Peringatan!
                </h1>
                <p className="text-xl md:text-3xl font-black text-white uppercase tracking-widest max-w-3xl leading-snug">
                  Aktivitas mencurigakan terdeteksi.<br/>Tindakan ini direkam oleh sistem pengawas aplikasi ujian.
                </p>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Announcement Modal */}
      <AnimatePresence>
        {viewedAnnouncement && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-100/80 backdrop-blur-md"
              onClick={() => handleDismissAnnouncement(viewedAnnouncement.id)}
            ></motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="relative w-full max-w-2xl bg-white p-6 md:p-10 rounded-3xl shadow-2xl border border-slate-200 z-10 mx-4"
            >
              <div className="flex items-center gap-6 mb-8 border-b border-slate-100 pb-8">
                 <div className="w-16 h-16 rounded-2xl bg-[#85cc00]/10 flex items-center justify-center text-[#85cc00]">
                    <AlertCircle className="w-8 h-8" />
                 </div>
                 <div>
                    <h3 className="text-2xl font-display font-black text-slate-900">{viewedAnnouncement.title || "Pengumuman"}</h3>
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-xs font-bold text-slate-500">
                      <span className="bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                        Pengirim: {viewedAnnouncement.author || "Guru"}
                      </span>
                      <span className="bg-[#85cc00]/10 text-slate-900 px-2.5 py-1 rounded-lg border border-[#85cc00]/20 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-[#85cc00]" />
                        <span>Tanggal Terbit: {(() => {
                            const dateStr = viewedAnnouncement.publishDate || viewedAnnouncement.createdAt;
                            if (!dateStr) return "-";
                            if (typeof dateStr === "string" && dateStr.includes("-") && dateStr.length === 10) {
                              const [y, m, d] = dateStr.split("-");
                              const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
                              return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
                            }
                            const d = new Date(dateStr);
                            return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("id-ID", { day: 'numeric', month: 'long', year: 'numeric' });
                        })()}</span>
                      </span>
                    </div>
                 </div>
              </div>
              
              <div className="mb-12">
                 <p className="text-slate-700 leading-relaxed font-semibold whitespace-pre-wrap text-lg">
                   {viewedAnnouncement.content}
                 </p>
              </div>
              
              <div className="flex gap-4">
                 <button
                    onClick={() => handleDismissAnnouncement(viewedAnnouncement.id)}
                    className="w-full py-5 bg-[#85cc00] text-slate-900 rounded-xl text-sm font-black uppercase tracking-wider shadow-lg shadow-[#85cc00]/20 hover:brightness-110 transition-all flex justify-center items-center gap-3"
                 >
                    Tutup & Hapus Pengumuman
                 </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Dynamic Luxurious Cheat Exit Warning Modal */}
      <AnimatePresence>
        {showExitWarningModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-100/80 backdrop-blur-md"
              onClick={() => setShowExitWarningModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="relative w-full max-w-md bg-white rounded-[2rem] md:rounded-[2.5rem] overflow-hidden shadow-2xl border border-slate-200 z-10 mx-auto max-h-[85vh] sm:max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="bg-white p-4 sm:p-6 px-6 sm:px-8 flex justify-between items-center shrink-0 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 sm:p-2 bg-rose-50 rounded-xl text-rose-500">
                    <AlertOctagon className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-display font-black text-xs sm:text-sm uppercase tracking-widest text-rose-600">
                      INTEGRITAS SISTEM CBT
                    </h4>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                      DEWAN PENGAWAS DIGITAL SMA
                    </p>
                  </div>
                </div>
                
                <button
                  type="button"
                  onClick={() => setShowExitWarningModal(false)}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-slate-50 border border-slate-200 text-slate-400 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </div>

              {/* Scrollable Modal Content Body */}
              <div className="p-5 sm:p-8 space-y-4 sm:space-y-6 overflow-y-auto">
                <div className="text-center space-y-2">
                  <div className="w-14 h-14 sm:w-20 sm:h-20 bg-rose-50 border border-rose-100 rounded-full flex items-center justify-center mx-auto text-rose-500 shadow-sm">
                    <AlertOctagon className="w-8 h-8 sm:w-10 sm:h-10" />
                  </div>
                  <div className="space-y-1">
                    <h5 className="font-display font-black text-lg sm:text-xl text-slate-900 px-2 leading-tight">
                      Apakah Anda benar-benar mau berbuat curang?
                    </h5>
                    <p className="text-[10px] sm:text-xs font-bold text-rose-600 uppercase tracking-widest">
                      PERINGATAN KERAS: UPAYA MENINGGALKAN UJIAN
                    </p>
                  </div>
                </div>

                {/* Elegant dynamic warn explanation box */}
                <div className="p-4 sm:p-6 bg-rose-50/50 border border-rose-100 rounded-2xl sm:rounded-3xl text-left space-y-3 sm:space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse"></span>
                    <span className="text-[9px] sm:text-[10px] font-black text-rose-800 uppercase tracking-wider">STATUS: KOORDINASI PENGAWAS</span>
                  </div>
                  
                  <p className="text-[11px] sm:text-[12px] font-semibold text-slate-700 leading-relaxed">
                    Sistem mendeteksi upaya penekanan menu atau keluar dari navigasi lembar ujian yang sedang aktif. Tindakan meninggalkan halaman secara sengaja dikategorikan sebagai <strong className="text-rose-600 font-black">Tindakan Pelanggaran (Kecurangan)</strong>.
                  </p>

                  <div className="text-[10px] sm:text-[11px] text-rose-900 bg-white border border-rose-100 p-3 sm:p-4 rounded-xl leading-relaxed font-mono">
                    <strong className="text-slate-800 font-black">KONSEKUENSI NILAI & CATATAN:</strong><br/>
                    ✓ Setiap pelanggaran terekam di dashboard Guru.<br/>
                    ✓ Jika klik <strong className="text-rose-600">YA</strong>, lembar ujian akan langsung dikirim & ditutup paksa!<br/>
                    ✓ Nilai pengerjaan Anda saat ini akan dibatalkan/didiskualifikasi.
                  </div>
                </div>

                {/* Confirm Buttons Column */}
                <div className="flex flex-col gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowExitWarningModal(false)}
                    className="w-full h-12 sm:h-14 bg-[#85cc00] hover:brightness-110 active:scale-95 text-slate-950 font-extrabold text-[11px] sm:text-xs uppercase tracking-widest rounded-xl sm:rounded-2xl shadow-lg shadow-[#85cc00]/20 transition-all text-center flex items-center justify-center cursor-pointer"
                  >
                    Tidak, Saya Tidak Akan Curang
                  </button>
                  <button
                    type="button"
                    onClick={confirmCheatExit}
                    className="w-full h-12 sm:h-14 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 font-extrabold text-[11px] sm:text-xs uppercase tracking-widest rounded-xl sm:rounded-2xl border-2 border-slate-200 hover:border-rose-200 transition-all text-center flex items-center justify-center cursor-pointer"
                  >
                    Ya, Saya Akan Curang
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* WhatsApp Share Modal for Student */}
      {isWaModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-indigo-950/80 backdrop-blur-md p-4 sm:p-6 select-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white w-full max-w-xl rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col border-2 border-slate-200"
          >
            {/* Header */}
            <div className="bg-slate-50 px-8 py-6 flex justify-between items-center border-b border-slate-200 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 text-emerald-700 rounded-2xl">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-display font-black text-lg text-slate-900 tracking-tight">Kirim Laporan via WhatsApp</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-0.5">Orang Tua / Wali Murid</p>
                </div>
              </div>
              <button
                onClick={() => setIsWaModalOpen(false)}
                className="text-slate-400 hover:text-slate-900 transition-all p-2 hover:bg-slate-150 rounded-xl active:scale-95 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-8 space-y-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Nama Siswa</label>
                  <p className="font-bold text-sm text-slate-900">{student?.displayName}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">NISN / Kelas</label>
                  <p className="font-bold text-sm text-slate-900">{student?.nisn} (Kl. {student?.kelas || "-"})</p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest block ml-1">Nomor WA Orang Tua</label>
                <input
                  type="text"
                  value={waParentPhone}
                  onChange={(e) => setWaParentPhone(e.target.value)}
                  placeholder="Contoh: 628123456789"
                  className="w-full bg-slate-50 border-2 border-slate-200 focus:border-emerald-500 focus:bg-white rounded-2xl px-6 py-4 text-sm font-bold tracking-wider text-slate-900 outline-none transition-all placeholder:text-slate-400"
                />
                <span className="text-[10px] text-slate-400 font-bold block ml-1 leading-relaxed">
                  *Gunakan kode negara di awal (misal *62* untuk Indonesia, jangan gunakan spasi atau tanda hubung).
                </span>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-500 uppercase tracking-widest block ml-1">Preview Memo Laporan</label>
                <div className="w-full bg-emerald-50/50 border border-emerald-100 rounded-2xl p-6 font-mono text-[11px] leading-relaxed text-emerald-950 whitespace-pre-wrap select-text max-h-[220px] overflow-y-auto custom-scrollbar shadow-inner">
                  {waDraftMessage}
                </div>
              </div>
            </div>

            {/* Sticky Actions */}
            <div className="p-6 bg-slate-50 border-t border-slate-200 flex gap-4 shrink-0">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(waDraftMessage);
                  setCopiedIndex(true);
                  setTimeout(() => setCopiedIndex(false), 2000);
                }}
                className={`flex-1 py-4 text-center rounded-2xl text-xs font-black uppercase tracking-wider active:scale-95 transition-all outline-none border cursor-pointer ${
                  copiedIndex
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                    : "bg-white border-slate-200 hover:bg-slate-100 text-slate-700"
                }`}
              >
                {copiedIndex ? "Tersalin!" : "Salin Teks"}
              </button>
              <button
                onClick={() => {
                  const cleanedPhone = waParentPhone.replace(/[^0-9]/g, "");
                  const finalPhone = cleanedPhone.startsWith("0") 
                    ? "62" + cleanedPhone.slice(1) 
                    : cleanedPhone;
                  
                  const waUrl = `https://api.whatsapp.com/send?phone=${finalPhone}&text=${encodeURIComponent(waDraftMessage)}`;
                  window.open(waUrl, "_blank", "noopener,noreferrer");
                }}
                className="flex-1 py-4 bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 transition-all text-center rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-600/25 cursor-pointer"
              >
                Kirim via WhatsApp
              </button>
            </div>
          </motion.div>
        </div>
      )}


      {/* Info Sekolah Modal */}
      <AnimatePresence>
        {isSchoolInfoOpen && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-md"
              onClick={() => setIsSchoolInfoOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-2xl border border-slate-200 z-10 mx-auto"
            >
              <div className="flex items-center gap-4 mb-6 border-b border-slate-100 pb-5">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-black text-slate-900 font-bold">SMA Negeri 1 Cililin</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Profil Portal Akademik</p>
                </div>
              </div>
              <div className="space-y-4 text-xs sm:text-sm text-slate-600 font-semibold leading-relaxed">
                <p>
                  <strong>Portal Si Pinter</strong> adalah sistem akademik terintegrasi untuk siswa-siswi SMA Negeri 1 Cililin dalam memonitor kelengkapan tugas harian, nilai evaluasi, pengumuman, dan pengerjaan Ujian CBT mandiri.
                </p>
                <div className="p-4 bg-slate-50 rounded-2xl space-y-2 font-mono text-[11px] text-slate-700 leading-normal border border-slate-200">
                  <p>📍 <strong>Alamat:</strong> Jl. Radio No. 1 Cililin, Kabupaten Bandung Barat, Jawa Barat</p>
                  <p>📧 <strong>Email:</strong> sman1cililin@gmail.com</p>
                  <p>💻 <strong>Sistem:</strong> Si Pinter CBT v2.5.0</p>
                </div>
              </div>
              <button
                onClick={() => setIsSchoolInfoOpen(false)}
                className="w-full mt-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md shadow-indigo-600/15 cursor-pointer"
              >
                Tutup Informasi
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Ganti Password Modal */}
      <AnimatePresence>
        {isChangePasswordOpen && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-md"
              onClick={() => setIsChangePasswordOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-white p-6 sm:p-8 rounded-3xl shadow-2xl border border-slate-200 z-10 mx-auto"
            >
              <div className="flex items-center gap-4 mb-6 border-b border-slate-100 pb-5">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-black text-slate-900 font-bold">Keamanan Akun</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Ganti Password Siswa</p>
                </div>
              </div>
              <div className="space-y-4 text-xs sm:text-sm text-slate-600 font-semibold leading-relaxed">
                <p>
                  Untuk alasan keamanan dan keselarasan data sekolah, penggantian password akun siswa dilayani langsung oleh **Admin Kurikulum & Operator Dapodik SMAN 1 Cililin**.
                </p>
                <p className="p-4 bg-amber-50/50 text-amber-900 rounded-2xl text-[11px] leading-relaxed font-mono border border-amber-100">
                  Silakan hubungi Wali Kelas atau Tim Teknis IT Sekolah di ruang ICT untuk mengajukan reset sandi/password secara aman.
                </p>
              </div>
              <button
                onClick={() => setIsChangePasswordOpen(false)}
                className="w-full mt-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                Saya Mengerti
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Tips Belajar Modal */}
      <AnimatePresence>
        {isTipsModalOpen && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-md"
              onClick={() => setIsTipsModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-2xl bg-white rounded-[2.5rem] shadow-2xl border-2 border-slate-200/80 z-10 mx-auto overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in duration-300"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6 flex justify-between items-center text-white shrink-0">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-white/10 rounded-2xl">
                    <Lightbulb className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-black leading-tight">Panduan & Tips Belajar</h3>
                    <p className="text-xs font-bold text-blue-100 uppercase tracking-widest mt-0.5">Strategi Sukses Belajar Informatika</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsTipsModalOpen(false)}
                  className="text-white/85 hover:text-white transition-all p-2 hover:bg-white/10 rounded-xl active:scale-95 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-8 space-y-6 overflow-y-auto max-h-[55vh] custom-scrollbar">
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Kiat Sukses Menguasai Materi</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    {
                      title: "Literasi Digital Mandiri",
                      desc: "Gunakan menu Literasi untuk mengakses modul PDF dan video pembelajaran. Belajar secara mandiri adalah kunci sukses Kurikulum Merdeka.",
                      icon: BookOpen,
                      color: "text-blue-600 bg-blue-50 border-blue-100",
                    },
                    {
                      title: "Pantau Tugas & Progres",
                      desc: "Pastikan status tugasmu 'Sudah Dinilai'. Gunakan riwayat pengiriman untuk meninjau kembali feedback dari Guru Pembimbing.",
                      icon: Target,
                      color: "text-indigo-600 bg-indigo-50 border-indigo-100",
                    },
                    {
                      title: "Integritas Ujian CBT",
                      desc: "Saat Ujian Online aktif, sistem akan memantau fokus Anda. Jaga status integritas tetap 'Sangat Berintegritas' untuk hasil yang valid.",
                      icon: ShieldCheck,
                      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
                    },
                    {
                      title: "Kehadiran & Kedisiplinan",
                      desc: "Kehadiran harian mencerminkan kedisiplinan Anda. Pastikan Anda selalu hadir tepat waktu di setiap pertemuan kelas.",
                      icon: Clock,
                      color: "text-amber-600 bg-amber-50 border-amber-100",
                    },
                    {
                      title: "Informasi Terintegrasi",
                      desc: "Selalu periksa menu 'Pengumuman' di dasbor untuk mendapatkan update terbaru mengenai jadwal ujian atau info sekolah lainnya.",
                      icon: Sparkles,
                      color: "text-rose-600 bg-rose-50 border-rose-100",
                    }
                  ].map((tip, i) => (
                    <div key={`cbt-tips-card-${tip.title || i}-${i}`} className="p-5 rounded-2xl border border-slate-100 bg-slate-50/50 hover:bg-white hover:shadow-md hover:border-slate-200 transition-all flex gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${tip.color}`}>
                        <tip.icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm leading-tight mb-1">{tip.title}</h4>
                        <p className="text-xs font-semibold text-slate-500 leading-relaxed">{tip.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end shrink-0">
                <button
                  onClick={() => setIsTipsModalOpen(false)}
                  className="px-6 py-3 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
                >
                  Mulai Belajar Sekarang
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Beautiful Dynamic Toast for Sync Notifications */}
      <AnimatePresence>
        {syncToastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="fixed bottom-6 left-4 right-4 md:left-auto md:right-6 z-[100] max-w-sm bg-slate-900 text-white p-4.5 rounded-2xl shadow-xl flex items-center gap-3.5 border border-slate-800"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="w-4.5 h-4.5" />
            </div>
            <p className="text-xs font-semibold text-slate-200">
              {syncToastMessage}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logout Modal */}
      <AnimatePresence>
        {showLogoutModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
              onClick={() => setShowLogoutModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-rose-500 to-orange-500" />
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-full bg-rose-50 flex items-center justify-center mb-6">
                  <Power className="w-10 h-10 text-rose-500" />
                </div>
                <h3 className="text-2xl font-display font-black text-slate-900 tracking-tight mb-2">
                  Konfirmasi Keluar
                </h3>
                <p className="text-slate-500 font-medium mb-8">
                  Apakah Anda Yakin Ingin Keluar dari sesi ini?
                </p>
                <div className="flex w-full gap-3">
                  <button
                    onClick={() => setShowLogoutModal(false)}
                    className="flex-1 py-3.5 px-4 rounded-2xl border-2 border-slate-200 text-slate-700 font-bold hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    onClick={handleLogout}
                    className="flex-1 py-3.5 px-4 rounded-2xl bg-rose-500 text-white font-bold hover:bg-rose-600 shadow-lg shadow-rose-500/30 transition-all cursor-pointer"
                  >
                    Ya, Keluar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      </div>
      </div>
      </main>
      </div> {/* Close Main Content Viewport */}
      {/* Floating Photo Warning */}
      <AnimatePresence>
        {showPhotoWarning && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[150] w-[90%] max-w-md"
          >
            <div className="bg-white border-2 border-[#85cc00] rounded-2xl p-5 shadow-2xl flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-[#85cc00]/20 flex items-center justify-center shrink-0">
                  <Camera className="w-6 h-6 text-[#85cc00]" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-slate-900 leading-tight">Segera Tambahkan Foto Profil Anda</h4>
                  <p className="text-[11px] text-slate-500 font-medium mt-1">
                    Silakan salin (copy) dan tempel (paste) <strong>link Google Drive</strong> foto Anda melalui menu Profil agar mudah dikenali oleh Guru.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowPhotoWarning(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Paste Helper Dialog Modal */}
      <AnimatePresence>
        {showPasteDialog && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-6 shadow-2xl border border-slate-200 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-2xl border border-blue-100">
                    <Clipboard className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Tempelkan (Paste) Tautan Tugas</h3>
                    <p className="text-[11px] font-semibold text-slate-500">Izin clipboard otomatis dibatasi oleh browser/iFrame.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasteDialog(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-700">
                  Klik kolom di bawah ini lalu tekan <span className="font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">Ctrl + V</span> atau <span className="font-black text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">Tahan &amp; Tempel</span>:
                </label>
                <input
                  type="text"
                  autoFocus
                  value={pasteDialogText}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPasteDialogText(val);
                    if (val.trim().startsWith("http")) {
                      setSelectedFile(val.trim());
                    }
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData("text");
                    if (pasted) {
                      setPasteDialogText(pasted);
                      setSelectedFile(pasted.trim());
                    }
                  }}
                  placeholder="Klik di sini, lalu tekan Ctrl + V..."
                  className="w-full px-4 py-3 bg-slate-50 border-2 border-blue-400 focus:border-blue-600 rounded-2xl text-xs font-semibold focus:outline-none transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPasteDialog(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (pasteDialogText.trim()) {
                      setSelectedFile(pasteDialogText.trim());
                    }
                    setShowPasteDialog(false);
                  }}
                  className="px-5 py-2.5 text-xs font-black text-white bg-[#85cc00] hover:bg-[#72b000] rounded-xl shadow-md transition-all cursor-pointer active:scale-95"
                >
                  Gunakan Tautan Ini
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
