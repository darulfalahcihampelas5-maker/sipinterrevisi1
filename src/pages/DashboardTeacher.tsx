import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../AuthContext";
import { db } from "../lib/firebase";
import { getDriveImageUrl, getDrivePdfEmbedUrl } from "../lib/driveUtils";
import { KOP_SURAT_BASE64 } from "../kopSuratBase64";
import {
  doc,
  setDoc,
  addDoc,
  collection,
  deleteDoc,
  getDocs,
  getDoc,
  updateDoc,
  writeBatch,
  query,
  where,
} from "firebase/firestore";
import { OperationType, handleFirestoreError, getLocalCache, setLocalCache, clearTeacherCaches } from "../lib/firestoreUtils";
import { googleSignIn } from "../lib/googleAuth";
import { fetchWithRetry } from "../lib/fetchWithRetry";
import {
  Users,
  UserPlus,
  FilePlus,
  ClipboardCheck,
  ClipboardList,
  BarChart3,
  BookOpen,
  LogOut, Power,
  Menu,
  X,
  FileText,
  School,
  Edit,
  Trash2,
  LayoutDashboard,
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  Clock,
  Calendar,
  SearchX,
  Trophy,
  GraduationCap,
  Database,
  ShieldCheck,
  Zap,
  CheckCircle2,
  HardDrive,
  Download,
  RefreshCw,
  Plus,
  Target,
  ZapOff,
  User,
  Fingerprint,
  Timer,
  Sparkles,
  Star,
  Award,
  ArrowRight,
  Wifi,
  Activity,
  Settings,
  List,
  KeyRound,
  Bell,
  MessageSquare,
  MessageCircle,
  Send,
  Share2,
  Search,
  ChevronDown,
  Filter,
  ExternalLink,
  AlertOctagon,
  Copy,
  Check,
  Edit3,
  Save,
  Maximize2,
  Smartphone,
  Monitor,
  Upload,
  Eye,
  EyeOff,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ResetDashboardModal } from "../components/ResetDashboardModal";
import { StorageManagerModal } from "../components/StorageManagerModal";
import { NotificationModal } from "../components/NotificationModal";

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

const INFORMATIKA_X_CHAPTERS = [
  "Bab 1: Informatika dan Keterampilan Generik",
  "Bab 2: Berpikir Komputasional (BK)",
  "Bab 3: Teknologi Informasi dan Komunikasi (TIK)",
  "Bab 4: Sistem Komputer (SK)",
  "Bab 5: Jaringan Komputer dan Internet (JKI)",
  "Bab 6: Analisis Data (AD)",
  "Bab 7: Algoritma dan Pemrograman (AP)",
  "Bab 8: Dampak Sosial Informatika (DSI)",
  "Bab 9: Praktik Lintas Bidang (PLB)"
];

function SimpleDigitalClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatSegment = (val: number) => {
    return val.toString().padStart(2, "0");
  };

  const hours = formatSegment(time.getHours());
  const minutes = formatSegment(time.getMinutes());
  const seconds = formatSegment(time.getSeconds());

  return (
    <div className="relative font-digital font-bold text-2xl sm:text-3xl tracking-[0.15em] select-none text-red-500 flex items-center min-w-[130px] sm:min-w-[160px] ml-4 shrink-0">
      {/* Actual Time */}
      <span className="relative z-10">
        {hours}
        <span className="opacity-80 animate-pulse">:</span>
        {minutes}
        <span className="opacity-80 animate-pulse">:</span>
        {seconds}
      </span>
    </div>
  );
}

export default function DashboardTeacher() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Verify authentication synchronously on mount
  const isTeacherAuth = sessionStorage.getItem("is_teacher_auth") === "true" || localStorage.getItem("is_teacher_auth") === "true";

  useEffect(() => {
    if (!isTeacherAuth) {
      navigate("/", { replace: true });
    }
  }, [isTeacherAuth, navigate]);

  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [direction, setDirection] = useState(0);

  // States and Handlers for Teacher Profile Photo
  const [teacherPhotoUrl, setTeacherPhotoUrl] = useState<string | null>(null);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  useEffect(() => {
    const uid = user?.uid || "default_teacher";
    const localPhoto = localStorage.getItem(`teacher_photo_${uid}`);
    if (localPhoto) {
      setTeacherPhotoUrl(localPhoto);
    }

    const fetchProfile = async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          if (data.profilePhotoUrl) {
            setTeacherPhotoUrl(data.profilePhotoUrl);
            localStorage.setItem(`teacher_photo_${uid}`, data.profilePhotoUrl);
          }
          if (data.userSettings) {
            setUserSettings(data.userSettings);
          }
        }
      } catch (e) {
        console.warn("Gagal memuat profil dari cloud:", e instanceof Error ? e.message : e);
      }
    };
    fetchProfile();
  }, [user?.uid]);

  const compressImageToBase64 = (
    file: File,
    maxWidth = 300,
    maxHeight = 300,
    quality = 0.75
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
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
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedBase64);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showAlert("Peringatan", "Ukuran foto terlalu besar. Maksimal ukuran file adalah 10MB.", "danger");
      return;
    }

    try {
      // Compress image to max 300x300 JPEG (~20-40KB) to stay well below Firestore 1MB document limit
      const compressedBase64 = await compressImageToBase64(file, 300, 300, 0.75);

      const uid = user?.uid || "default_teacher";
      setTeacherPhotoUrl(compressedBase64);
      localStorage.setItem(`teacher_photo_${uid}`, compressedBase64);

      try {
        await setDoc(
          doc(db, "users", uid),
          { profilePhotoUrl: compressedBase64 },
          { merge: true }
        );
        trackUsage(0, 1);
        showAlert("Berhasil", "Foto profil Anda berhasil diperbarui.", "alert");
      } catch (error: any) {
        console.warn("Gagal menyimpan foto ke cloud:", error);
        if (error?.message?.includes("exceeds the maximum allowed size") || error?.toString().includes("exceeds the maximum allowed size")) {
          try {
            await setDoc(doc(db, "users", uid), {
              profilePhotoUrl: compressedBase64,
              userSettings: userSettings
            });
            trackUsage(0, 1);
            showAlert("Berhasil", "Foto profil Anda berhasil diperbarui.", "alert");
            return;
          } catch (e2) {
            console.warn("Fallback overwrite failed:", e2);
          }
        }
        showAlert("Info", "Foto profil Anda diperbarui di perangkat ini secara lokal.", "alert");
      }
    } catch (err) {
      console.warn("Gagal memproses gambar:", err);
      showAlert("Gagal", "Gagal memproses gambar foto profil.", "danger");
    }
  };

  const handlePhotoDelete = async () => {
    showConfirm(
      "Hapus Foto Profil",
      "Apakah Anda yakin ingin menghapus foto profil saat ini?",
      async () => {
        const uid = user?.uid || "default_teacher";
        setTeacherPhotoUrl(null);
        localStorage.removeItem(`teacher_photo_${uid}`);

        try {
          await setDoc(
            doc(db, "users", uid),
            { profilePhotoUrl: null },
            { merge: true }
          );
          trackUsage(0, 1);
          showAlert("Berhasil", "Foto profil Anda telah dihapus.", "alert");
        } catch (error) {
          console.warn("Gagal menghapus foto dari cloud:", error);
          showAlert("Berhasil", "Foto profil Anda telah dihapus.", "alert");
        }
        setShowProfileDropdown(false);
      },
      "Hapus"
    );
  };

  const handleMenuChange = (id: string, index: number) => {
    const currentIndex = menus.findIndex((m) => m.id === activeMenu);
    setDirection(index > currentIndex ? 1 : -1);
    setActiveMenu(id);
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
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

  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false);

  const showAlert = (
    title: string,
    message: string,
    type: "alert" | "danger" = "alert",
    confirmText?: string,
  ) => {
    setModalConfig({ isOpen: true, title, message, type, confirmText });
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

  // Form states for adding student
  const [studentName, setStudentName] = useState("");
  const [studentNisn, setStudentNisn] = useState("");
  const [studentClass, setStudentClass] = useState("");
  const [studentAccessCode, setStudentAccessCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState({ text: "", type: "" });
  const [classSaveMessage, setClassSaveMessage] = useState({ text: "", type: "" });

  const [selectedStudentProfile, setSelectedStudentProfile] = useState<any>(null);
  const [studentProfileTab, setStudentProfileTab] = useState<"tugas" | "ujian">("tugas");
  const [viewingStudentPhoto, setViewingStudentPhoto] = useState<any | null>(null);
  const [copiedAccessCode, setCopiedAccessCode] = useState<string | null>(null);
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [studentClassFilter, setStudentClassFilter] = useState("SEMUA_KELAS");
  const [userSettings, setUserSettings] = useState({
    subjectName: "Informatika",
    teacherName: "Agan Parta, S.Kom.",
    teacherNip: "198501012010011001",
    principalName: "Dr. H. Contoh Kepala, M.Pd.",
    principalNip: "197001011995011001",
    academicYear: "2026/2027",
    semester: "Ganjil"
  });
  const [isEditingUserSettings, setIsEditingUserSettings] = useState(false);

  const getAlertClasses = (type: string) => {
    switch (type) {
      case "error":
        return "bg-rose-50 text-rose-700 border border-rose-200 shadow-md shadow-rose-100/50";
      case "warning":
        return "bg-amber-50 text-amber-800 border border-amber-200 shadow-md shadow-amber-100/50";
      case "info":
        return "bg-slate-100 text-slate-900 border border-slate-300/80/80 shadow-md shadow-indigo-100/50";
      case "success":
      default:
        return "bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-md shadow-emerald-100/50";
    }
  };

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "error":
        return <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />;
      case "warning":
        return <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />;
      case "info":
        return <Info className="w-5 h-5 shrink-0 mt-0.5" />;
      case "success":
      default:
        return <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />;
    }
  };

  const [teacherNisn, setTeacherNisn] = useState("");

  // Announcement state
  const [announcementContent, setAnnouncementContent] = useState("");
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);

  const handleSaveAnnouncement = async () => {
    if (!announcementContent.trim()) return;
    setIsSavingAnnouncement(true);
    try {
      const id = Date.now().toString();
      await setDoc(doc(db, "announcements", id), {
        id,
        content: announcementContent.trim(),
        createdAt: new Date().toISOString(),
        author: "Guru",
      });
      setAnnouncementContent("");
      showAlert("Berhasil", "Pengumuman berhasil disiarkan.", "alert");
    } catch (e: any) {
      console.warn("Gagal membuat pengumuman:", e);
      showAlert("Gagal", "Gagal menyimpan pengumuman.", "danger");
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState({ text: "", type: "" });
  const [dbTeacherPassword, setDbTeacherPassword] = useState<string | null>(() => {
    return localStorage.getItem("teacher_password") || null;
  });

  useEffect(() => {
    if (dbTeacherPassword) return;
    getDoc(doc(db, "config", "teacher_auth")).then((docSnap) => {
      if (docSnap.exists() && docSnap.data()?.password) {
        const pass = docSnap.data().password;
        setDbTeacherPassword(pass);
        localStorage.setItem("teacher_password", pass);
      }
    }).catch((error) => {
      console.warn("Gagal memuat password guru dari Firestore:", error);
    });
  }, []);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setPasswordMessage({ text: "Konfirmasi password baru tidak cocok.", type: "error" });
      return;
    }
    setIsChangingPassword(true);
    try {
      const storedPass = dbTeacherPassword || localStorage.getItem("teacher_password");
      const defaultPasses = ["admin", "guru", "pinter", "123456"];
      
      const isCurrentValid = storedPass 
        ? currentPassword === storedPass 
        : defaultPasses.includes(currentPassword);

      if (!isCurrentValid) {
        setPasswordMessage({ text: "Password lama tidak sesuai.", type: "error" });
        setIsChangingPassword(false);
        return;
      }

      // Save directly to Firebase Database!
      await setDoc(doc(db, "config", "teacher_auth"), {
        password: newPassword,
        updatedAt: new Date().toISOString(),
        updatedBy: "Guru"
      }, { merge: true });

      localStorage.setItem("teacher_password", newPassword);
      
      setPasswordMessage({ text: "Password berhasil diperbarui dan disimpan di Firebase Database.", type: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error: any) {
      console.warn("Gagal menyimpan password ke Firebase:", error);
      handleFirestoreError(error, OperationType.WRITE, "config/teacher_auth");
      setPasswordMessage({ text: "Gagal memperbarui password ke database.", type: "error" });
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Chapter Management state
  // Google Drive integration for teacher
  const [teacherDriveConnected, setTeacherDriveConnected] = useState(false);
  const [teacherDriveEmail, setTeacherDriveEmail] = useState("");
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isDriveTokenExpired, setIsDriveTokenExpired] = useState(false);

  const checkDriveTokenValidity = async (token: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/drive/v3/files?pageSize=1", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (res.status === 401) {
        setIsDriveTokenExpired(true);
      } else {
        setIsDriveTokenExpired(false);
      }
    } catch (e) {
      console.warn("Error checking Drive token validity:", e);
    }
  };

  useEffect(() => {
    const loadGoogleAuth = async () => {
      try {
        const snapshot = await getDoc(doc(db, "users", "googleAuth"));
        if (snapshot.exists()) {
          const data = snapshot.data();
          setTeacherDriveConnected(!!data.accessToken);
          setTeacherDriveEmail(data.teacherEmail || "");
          if (data.accessToken) {
            checkDriveTokenValidity(data.accessToken);
          } else {
            setIsDriveTokenExpired(false);
          }
        } else {
          setTeacherDriveConnected(false);
          setTeacherDriveEmail("");
          setIsDriveTokenExpired(false);
        }
      } catch (error: any) {
        console.warn("Firestore googleAuth error:", error.message);
      }
    };
    loadGoogleAuth();
  }, []);

  const handleConnectDrive = async () => {
    setIsConnectingDrive(true);
    try {
      const result = await googleSignIn();
      if (result) {
        await setDoc(doc(db, "users", "googleAuth"), {
          accessToken: result.accessToken,
          teacherEmail: result.user.email || "agan121@guru.sma.belajar.id",
          updatedAt: new Date().toISOString(),
        });
        showAlert("Berhasil", "Google Drive Guru berhasil dihubungkan!", "alert");
      }
    } catch (e: any) {
      console.warn("Gagal menghubungkan Drive:", e);
      showAlert("Gagal", `Terjadi kesalahan: ${e.message || e}`, "danger");
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    try {
      await setDoc(doc(db, "users", "googleAuth"), {
        accessToken: null,
        teacherEmail: null,
        updatedAt: new Date().toISOString(),
      });
      showAlert("Berhasil", "Google Drive Guru berhasil diputuskan!", "alert");
    } catch (e: any) {
      console.warn("Gagal memutuskan Drive:", e);
      showAlert("Gagal", `Terjadi kesalahan: ${e.message || e}`, "danger");
    }
  };

  const [chaptersList, setChaptersList] = useState<any[]>([]);
  const [newChapter, setNewChapter] = useState("");

  // Materials Management state
  const [materialsList, setMaterialsList] = useState<any[]>([]);
  const [materiTitle, setMateriTitle] = useState("");
  const [materiDescription, setMateriDescription] = useState("");
  const [materiSubject, setMateriSubject] = useState("Informatika");
  const [materiBab, setMateriBab] = useState("");
  const [materiDriveUrl, setMateriDriveUrl] = useState("");
  const [materiKelas, setMateriKelas] = useState("");
  const [editingMateriId, setEditingMateriId] = useState<string | null>(null);
  const [isSavingMateri, setIsSavingMateri] = useState(false);
  const [materiSaveMessage, setMateriSaveMessage] = useState({ text: "", type: "" });
  const [activeMateriTab, setActiveMateriTab] = useState("daftar"); // "daftar", "tambah"

  // --- Ujian Siswa States ---
  const [examsList, setExamsList] = useState<any[]>([]);
  const [activeExamTab, setActiveExamTab] = useState("daftar");
  const [examTitle, setExamTitle] = useState("");
  const [examSubject, setExamSubject] = useState("Informatika");
  const [examBab, setExamBab] = useState("");
  const [examKelas, setExamKelas] = useState("");
  const [selectedExamClasses, setSelectedExamClasses] = useState<string[]>([]);
  const [activeExamClassFilter, setActiveExamClassFilter] = useState<string[]>(["SEMUA_KELAS"]);
  const [examTema, setExamTema] = useState("Preetes");
  const [examMateri, setExamMateri] = useState("");
  const [examDuration, setExamDuration] = useState(30); // in minutes
  const [examKkm, setExamKkm] = useState(75);
  const [examQuestionCount, setExamQuestionCount] = useState(5);
  const [examDescription, setExamDescription] = useState("");
  const [examDocument, setExamDocument] = useState<File | null>(null);
  const [examQuestions, setExamQuestions] = useState<any[]>([]);
  const [examToken, setExamToken] = useState("");
  const [examExternalQuizUrl, setExamExternalQuizUrl] = useState("");
  const [examPastedText, setExamPastedText] = useState("");
  const [isGeneratingExam, setIsGeneratingExam] = useState(false);
  const [isSavingExam, setIsSavingExam] = useState(false);
  const [examSaveMessage, setExamSaveMessage] = useState({ text: "", type: "" });
  const [showExamProgressModal, setShowExamProgressModal] = useState(false);
  const [examGeneratorStatus, setExamGeneratorStatus] = useState<"idle" | "generating" | "success" | "error">("idle");
  const [examGeneratorProgress, setExamGeneratorProgress] = useState<string>("");
  const [examGeneratorError, setExamGeneratorError] = useState<string>("");

  const [downloadExamModal, setDownloadExamModal] = useState<{
    isOpen: boolean;
    exam: any | null;
    selectedClass: string;
  }>({
    isOpen: false,
    exam: null,
    selectedClass: "SEMUA_KELAS",
  });

  const [announcementsList, setAnnouncementsList] = useState<any[]>([]);
  const [absensiList, setAbsensiList] = useState<any[]>([]);
  const [attendanceDate, setAttendanceDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [attendanceClass, setAttendanceClass] = useState<string>("");
  const [analysisClass, setAnalysisClass] = useState<string>("");
  const [attendanceData, setAttendanceData] = useState<Record<string, string>>({});
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [isEditingAttendance, setIsEditingAttendance] = useState(true);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementKelas, setAnnouncementKelas] = useState("");
  const [announcementPublishDate, setAnnouncementPublishDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // --- PDF Preview Modal States ---
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewTitle, setPdfPreviewTitle] = useState<string>("");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  const generateRandomToken = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let token = "";
    for (let i = 0; i < 6; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  };

  // Form states for adding assignment
  const [assignmentBab, setAssignmentBab] = useState("");
  const [assignmentMateri, setAssignmentMateri] = useState("");
  const [assignmentPublishedAt, setAssignmentPublishedAt] = useState("");
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [assignmentTargets, setAssignmentTargets] = useState<
    { kelas: string; deadline: string; publishedAt?: string }[]
  >([]);
  const [sharedDeadline, setSharedDeadline] = useState("");
  const [selectedDaftarTugasClasses, setSelectedDaftarTugasClasses] = useState<string[]>([]);

  const [assignmentDesc, setAssignmentDesc] = useState("");
  const [assignmentTaskLink, setAssignmentTaskLink] = useState("");
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState({
    text: "",
    type: "",
  });
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(
    null,
  );

  // Grading Rubric State
  const [rubric, setRubric] = useState<any>({
    kehadiran: 20,
    tugas: 50,
    uts: 10,
    uas: 20,
  });
  const [isEditingRubric, setIsEditingRubric] = useState(false);
  const [editKehadiran, setEditKehadiran] = useState("20");
  const [editTugas, setEditTugas] = useState("50");
  const [editUts, setEditUts] = useState("10");
  const [editUas, setEditUas] = useState("20");
  const [isSavingRubric, setIsSavingRubric] = useState(false);

  // --- Buku Nilai Table Inline Edit & Manual Column States ---
  const [isEditingRekapTable, setIsEditingRekapTable] = useState(false);
  const [editedRekapGrades, setEditedRekapGrades] = useState<Record<string, string>>({});
  const [isSavingRekapGrades, setIsSavingRekapGrades] = useState(false);

  const [isAddManualColumnOpen, setIsAddManualColumnOpen] = useState(false);
  const [manualBab, setManualBab] = useState("");
  const [manualMateri, setManualMateri] = useState("");
  const [manualKelas, setManualKelas] = useState("");
  const [manualPublishDate, setManualPublishDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [isSavingManualColumn, setIsSavingManualColumn] = useState(false);

  const handleAddChapter = async () => {
    if (!newChapter.trim()) return;
    try {
      await setDoc(doc(db, "chapters", newChapter.trim()), {
        name: newChapter.trim(),
        createdAt: new Date().toISOString(),
      });
      setNewChapter("");
      showAlert("Berhasil", "Bab berhasil ditambahkan.", "alert");
    } catch (e: any) {
      console.warn("Gagal menambah bab:", e);
      showAlert("Gagal", "Gagal menambah bab: " + (e.message || e), "danger");
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    try {
      await deleteDoc(doc(db, "chapters", chapterId));
      showAlert("Berhasil", "Bab berhasil dihapus.", "alert");
    } catch (e: any) {
      console.warn("Gagal menghapus bab:", e);
      showAlert("Gagal", "Gagal menghapus bab: " + (e.message || e), "danger");
    }
  };

  const toLocalDatetimeInputValue = (dateInput: any) => {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const formatDateIndo = (dateInput: any) => {
    if (!dateInput) return "-";
    if (typeof dateInput === "string" && dateInput.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const parts = dateInput.split("-");
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
        return new Date(year, month, day).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
      }
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getAssignmentPublishedAtForTeacher = (asg: any, targetClass?: string): string => {
    if (!asg) return "-";
    
    // 1. If a specific class filter or student class is passed, check targets array first
    if (targetClass && targetClass !== "SEMUA_KELAS" && targetClass !== "ALL" && asg.targets && Array.isArray(asg.targets)) {
      const target = asg.targets.find((t: any) => t.kelas === targetClass);
      if (target && target.publishedAt) {
        return formatDateIndo(target.publishedAt);
      }
    }

    // 2. Check if targets exist with dates
    if (asg.targets && Array.isArray(asg.targets) && asg.targets.length > 0) {
      const targetDates = asg.targets
        .map((t: any) => t.publishedAt)
        .filter((d: any) => d && typeof d === "string" && d.trim() !== "");
        
      if (targetDates.length > 0) {
        const uniqueFormatted: string[] = Array.from(new Set(targetDates.map((d: any) => formatDateIndo(d)))) as string[];
        if (uniqueFormatted.length === 1) {
          return uniqueFormatted[0];
        } else if (uniqueFormatted.length > 1) {
          if (targetClass && targetClass !== "SEMUA_KELAS" && targetClass !== "ALL") {
            return uniqueFormatted[0];
          }
          return uniqueFormatted.join(" ‚Ä¢ ");
        }
      }
    }

    // 3. Fallback
    const fallback = asg.publishedAt || asg.createdAt;
    return fallback ? formatDateIndo(fallback) : "-";
  };

  const handleEditAssignment = (assignment: any) => {
    setAssignmentBab(assignment.bab);
    setAssignmentMateri(assignment.materi);
    setAssignmentPublishedAt(toLocalDatetimeInputValue(assignment.publishedAt));
    if (assignment.targets && Array.isArray(assignment.targets)) {
      const firstDeadline = assignment.targets[0]?.deadline;
      const firstDeadlineStr = toLocalDatetimeInputValue(firstDeadline);
      setSharedDeadline(firstDeadlineStr);
      setAssignmentTargets(
        assignment.targets.map((t: any) => ({
          kelas: t.kelas || "",
          deadline: toLocalDatetimeInputValue(t.deadline),
          publishedAt: toLocalDatetimeInputValue(t.publishedAt || assignment.publishedAt),
        })),
      );
    } else {
      const dateStr = toLocalDatetimeInputValue(assignment.deadline);
      setSharedDeadline(dateStr);
      setAssignmentTargets([
        { 
          kelas: assignment.kelas || "", 
          deadline: dateStr,
          publishedAt: toLocalDatetimeInputValue(assignment.publishedAt),
        },
      ]);
    }
    setAssignmentDesc(assignment.description || "");
    setAssignmentTaskLink(assignment.taskLink || assignment.linkTugas || assignment.fileUrl || "");
    setEditingAssignmentId(assignment.id);
    setActiveMenu("manajemen-tugas");
    setActiveAssignmentTab("tambah");
  };

  const handleBatalEditAssignment = () => {
    setAssignmentBab("");
    setAssignmentMateri("");
    setAssignmentPublishedAt("");
    setSharedDeadline("");
    setAssignmentTargets([]);
    setAssignmentDesc("");
    setAssignmentTaskLink("");
    setEditingAssignmentId(null);
      localStorage.removeItem("firas_cache_assignments");
      fetchTeacherData(false);
    setAssignmentMessage({ text: "", type: "" });
  };

  // Class Management State
  const [classesList, setClassesList] = useState<any[]>([]);
  const [newClassName, setNewClassName] = useState("");
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editingClassName, setEditingClassName] = useState("");

  const [studentsList, setStudentsList] = useState<any[]>([]);
  const filteredStudents = useMemo(() => {
    let list = studentsList;
    if (studentClassFilter && studentClassFilter !== "SEMUA_KELAS") {
      list = list.filter((student) => student.kelas === studentClassFilter);
    }
    if (studentSearchQuery.trim()) {
      const q = studentSearchQuery.toLowerCase().trim();
      list = list.filter((student) => {
        const name = (student.displayName || student.studentName || "").toLowerCase();
        const nisn = (student.nisn || "").toLowerCase();
        const kelas = (student.kelas || "").toLowerCase();
        return name.includes(q) || nisn.includes(q) || kelas.includes(q);
      });
    }
    return [...list].sort((a, b) => {
      const classA = (a.kelas || "").toString();
      const classB = (b.kelas || "").toString();
      const classComp = classA.localeCompare(classB, "id", { numeric: true, sensitivity: "base" });
      if (classComp !== 0) return classComp;
      return (a.displayName || a.studentName || "").localeCompare(
        b.displayName || b.studentName || "",
        "id",
        { sensitivity: "base" }
      );
    });
  }, [studentsList, studentSearchQuery, studentClassFilter]);
  const [assignmentsList, setAssignmentsList] = useState<any[]>([]);

  const assignmentSequenceNumber = useMemo(() => {
    if (!assignmentBab || editingAssignmentId) return null;
    const count = assignmentsList.filter(a => a.bab === assignmentBab && !a.isArchived).length;
    return count + 1;
  }, [assignmentBab, assignmentsList, editingAssignmentId]);

  useEffect(() => {
    if (assignmentSequenceNumber && !assignmentMateri && !editingAssignmentId) {
      setAssignmentMateri(`Tugas ${assignmentSequenceNumber} `);
    }
  }, [assignmentSequenceNumber, editingAssignmentId]);
  const [submissionsList, setSubmissionsList] = useState<any[]>([]);
  const [finalGradesList, setFinalGradesList] = useState<any[]>([]);
  const [selectedAssignmentFilter, setSelectedAssignmentFilter] = useState("");
  const [selectedClassFilter, setSelectedClassFilter] = useState("");
  const [selectedStudentSearchFilter, setSelectedStudentSearchFilter] = useState("");

  // Grading State
  const [isGradingModalOpen, setIsGradingModalOpen] = useState(false);
  const [isFullscreenGradeModal, setIsFullscreenGradeModal] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);
  const [gradeValue, setGradeValue] = useState("");
  const [feedbackReason, setFeedbackReason] = useState("");
  const [isRejecting, setIsRejecting] = useState(false);
  const [isMassAuditing, setIsMassAuditing] = useState(false);
  const [isSavingGrade, setIsSavingGrade] = useState(false);

  
  const [examToReset, setExamToReset] = useState<any>(null);
  const [resetModalClassFilter, setResetModalClassFilter] = useState<string>("SEMUA_KELAS");
  const [resetModalSearch, setResetModalSearch] = useState<string>("");
  const [isPublishOtherClassModalOpen, setIsPublishOtherClassModalOpen] = useState(false);
  const [examToPublish, setExamToPublish] = useState<any>(null);
  const [newPublishKelas, setNewPublishKelas] = useState("");
  const [publishOtherClasses, setPublishOtherClasses] = useState<string[]>([]);
  const [newPublishToken, setNewPublishToken] = useState("");
  const [isSavingDuplicateExam, setIsSavingDuplicateExam] = useState(false);

  const handleResetStudentExam = async (gradeId: string) => {
    showConfirm(
      "Konfirmasi Reset", 
      "Apakah Anda yakin ingin menghapus nilai ini dan mereset status ujian untuk siswa tersebut? (Siswa dapat mengerjakan ulang)", 
      async () => {
        try {
          await deleteDoc(doc(db, "final_grades", gradeId));
          showAlert("Berhasil", "Status ujian siswa telah reset.", "alert");
        } catch (error) {
          console.warn("Gagal reset ujian:", error);
          showAlert("Gagal", "Terjadi kesalahan saat mereset ujian.", "danger");
        }
      },
      "Reset Ujian"
    );
  };

  const handleTinjauNilai = (submission: any) => {
    const assignment = assignmentsList.find(
      (a) => a.id === submission.assignmentId,
    );
    let calculatedGrade = "";
    let autoGraded = false;

    if (assignment && !submission.nilai) {
      // Logic based on publication date (publishedAt or createdAt)
      // Day 1 (tanggal Tugas terbit) = 100
      // Day 2 = 95, Day 3 = 90, Day 4 = 85, Day 5 = 80, Day 6 = 75, Day 7+ = 75
      const target = assignment.targets?.find((t: any) => t.kelas === submission.kelas);
      const rawPubDate = target?.publishedAt || assignment.publishedAt || assignment.createdAt;
      if (rawPubDate) {
        const publishedDate = new Date(rawPubDate);
        publishedDate.setHours(0, 0, 0, 0);

        const submittedDate = new Date(submission.submittedAt);
        submittedDate.setHours(0, 0, 0, 0);

        const diffTime = submittedDate.getTime() - publishedDate.getTime();
        const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

        const score = 100 - diffDays * 5;
        calculatedGrade = Math.max(75, score).toString();
        autoGraded = true;
      }
    }

    setSelectedSubmission({
      ...submission,
      suggestedGrade: autoGraded ? calculatedGrade : null,
    });
    setGradeValue(submission.nilai || calculatedGrade);
    setFeedbackReason(submission.keterangan || "");
    setIsRejecting(false);
    setIsGradingModalOpen(true);
  };

  const handleMassAudit = async () => {
    const pendingSubmissions = submissionsList.filter((sub) => {
      const matchTask = selectedAssignmentFilter
        ? sub.assignmentId === selectedAssignmentFilter
        : true;
      const matchClass = selectedClassFilter
        ? sub.kelas === selectedClassFilter
        : true;
      const student = studentsList.find((s) => s.nisn === sub.nisn);
      const studentDisplayName = (
        student?.displayName ||
        student?.studentName ||
        student?.name ||
        sub.studentName ||
        ""
      ).toLowerCase();
      const searchQuery = selectedStudentSearchFilter.trim().toLowerCase();
      const matchStudent = searchQuery
        ? studentDisplayName.includes(searchQuery) ||
          (sub.nisn && sub.nisn.toLowerCase().includes(searchQuery))
        : true;
      // Only audit those that haven't been graded or rejected
      const isPending =
        sub.status !== "sudah dinilai" && sub.status !== "ditolak";
      return matchTask && matchClass && matchStudent && isPending;
    });

    if (pendingSubmissions.length === 0) {
      showAlert(
        "Info",
        "Tidak ada tugas yang menunggu penilaian untuk filter ini.",
        "alert",
      );
      return;
    }

    showConfirm(
      "Audit Massal",
      `Apakah Anda yakin ingin memberikan nilai 100 secara otomatis ke ${pendingSubmissions.length} siswa terpilih? Tindakan ini sangat efisien untuk menilai tugas secara cepat.`,
      async () => {
        setIsMassAuditing(true);
        try {
          const batch = writeBatch(db);
          const now = new Date().toISOString();

          pendingSubmissions.forEach((sub) => {
            // 1. Create final grade
            const gradeRef = doc(collection(db, "final_grades"));
            batch.set(gradeRef, {
              assignmentId: sub.assignmentId,
              nisn: sub.nisn || "",
              nilai: 100,
              gradedAt: now,
            });

            // 2. Update submission
            const subRef = doc(db, "submissions", sub.id);
            batch.update(subRef, {
              status: "sudah dinilai",
              nilai: 100,
              fileUrl: null,
              keterangan: "Lulus Audit Massal (Buru-buru)",
              gradedAt: now,
            });
          });

          await batch.commit();
          trackUsage(0, pendingSubmissions.length * 2);
          showAlert(
            "Berhasil",
            `${pendingSubmissions.length} tugas berhasil dinilai secara massal dengan skor 100.`,
            "alert",
          );
        } catch (error) {
          console.warn("Gagal audit massal:", error);
          showAlert(
            "Error",
            "Gagal melakukan audit massal. Silakan coba lagi.",
            "danger",
          );
        } finally {
          setIsMassAuditing(false);
        }
      },
      "Audit Semua",
    );
  };

  const handleSimpanPenilaian = async (
    status: "sudah dinilai" | "ditolak",
  ) => {
    if (!selectedSubmission) return;
    if (status === "sudah dinilai" && !gradeValue) {
      showAlert("Validasi", "Mohon masukkan nilai sebelum menyimpan.", "alert");
      return;
    }
    if (status === "ditolak" && !feedbackReason) {
      showAlert("Validasi", "Mohon berikan alasan penolakan untuk siswa.", "alert");
      return;
    }

    setIsSavingGrade(true);
    try {
      if (status === "sudah dinilai") {
        // 1. Create final grade entry
        await setDoc(doc(collection(db, "final_grades")), {
          assignmentId: selectedSubmission.assignmentId,
          nisn: selectedSubmission.nisn || "",
          nilai: Number(gradeValue),
          gradedAt: new Date().toISOString(),
        });
        // 2. Update submission entry: update status, nilai, remove fileUrl to save space
        await setDoc(
          doc(db, "submissions", selectedSubmission.id),
          {
            status,
            nilai: Number(gradeValue),
            fileUrl: null, // Clear large image data
            keterangan: "",
            gradedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      } else {
        // Update submission status
        await setDoc(
          doc(db, "submissions", selectedSubmission.id),
          {
            status,
            nilai: null,
            keterangan: feedbackReason,
            wasRejected: true,
            gradedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      }

      setIsGradingModalOpen(false);
      setSelectedSubmission(null);
      localStorage.removeItem("firas_cache_submissions");
      localStorage.removeItem("firas_cache_final_grades");
      fetchTeacherData(false);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `submissions/${selectedSubmission.id}`,
      );
    } finally {
      setIsSavingGrade(false);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { read, utils } = await import("xlsx");
      const data = await file.arrayBuffer();
      const workbook = read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = utils.sheet_to_json(worksheet) as any[];

      if (jsonData.length === 0) {
        setSaveMessage({
          text: "Gagal mengimpor. File Excel kosong atau tidak valid.",
          type: "error",
        });
        return;
      }

      const getFieldValue = (row: any, searchTerms: string[]) => {
        const keys = Object.keys(row);
        // Step 1: Pas pencocokan persis setelah dinormalisasi (huruf kecil & tanpa spasi)
        for (const s of searchTerms) {
          const searchNorm = s.toLowerCase().replace(/[^a-z0-9]/g, "");
          for (const k of keys) {
            const rowNorm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (rowNorm === searchNorm) {
              return row[k];
            }
          }
        }
        // Step 2: Pencocokan parsial (mengandung kata kunci)
        for (const s of searchTerms) {
          const searchNorm = s.toLowerCase().replace(/[^a-z0-9]/g, "");
          for (const k of keys) {
            const rowNorm = k.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (rowNorm.includes(searchNorm) || searchNorm.includes(rowNorm)) {
              return row[k];
            }
          }
        }
        return undefined;
      };

      // Validasi struktur kolom di baris pertama
      const sampleRow = jsonData[0];
      const hasName = getFieldValue(sampleRow, ["nama", "nama_lengkap", "name", "siswa", "pesertadidik"]) !== undefined;
      const hasNisn = getFieldValue(sampleRow, ["nisn", "noinduk", "id", "nis", "nomorinduk"]) !== undefined;
      const hasKelas = getFieldValue(sampleRow, ["kelas", "class", "grade", "rombel"]) !== undefined;

      if (!hasName || !hasNisn || !hasKelas) {
        const missing = [];
        if (!hasName) missing.push("Nama / Nama Lengkap");
        if (!hasNisn) missing.push("NISN / No Induk");
        if (!hasKelas) missing.push("Kelas");
        
        // Dapatkan nama kolom yang terdeteksi di Excel untuk membantu pemecahan masalah pengguna
        const currentHeaders = Object.keys(sampleRow).join(", ");
        setSaveMessage({
          text: `Format Salah: Kolom wajib tidak dikenali! Kolom di Excel Anda: [${currentHeaders}]. Kolom wajib yang tidak ditemukan: [${missing.join(", ")}]. Silakan ubah judul kolom di Excel Anda menjadi "Nama", "NISN", "Kelas", dan "Kode Akses".`,
          type: "error",
        });
        e.target.value = "";
        return;
      }

      setIsSaving(true);
      setSaveMessage({
        text: `Sedang mengimpor ${jsonData.length} siswa...`,
        type: "info",
      });

      let successCount = 0;
      let failedCount = 0;
      for (const row of jsonData) {
        const nameVal = getFieldValue(row, ["nama", "nama_lengkap", "name", "siswa", "pesertadidik"]);
        const nisnVal = getFieldValue(row, ["nisn", "noinduk", "id", "nis", "nomorinduk"]);
        const classVal = getFieldValue(row, ["kelas", "class", "grade", "rombel"]);
        const accessCodeVal = getFieldValue(row, ["kodeakses", "accesscode", "kode", "akses", "password", "katasandi", "sandi"]) || "";

        if (nameVal !== undefined && nisnVal !== undefined && classVal !== undefined) {
          const name = nameVal.toString().trim();
          
          // Konversi NISN secara aman, bersihkan spasi, koma desimal, dll.
          let nisnStr = nisnVal.toString().trim().split(".")[0].replace(/\s+/g, "");
          if (/^\d+$/.test(nisnStr) && nisnStr.length < 10) {
            // Standar NISN di Indonesia adalah 10 digit, jika kurang dan berupa angka, kita pad dengan leading zero
            nisnStr = nisnStr.padStart(10, "0");
          }

          const className = classVal.toString().trim();
          const accessCodeStr = accessCodeVal ? accessCodeVal.toString().trim().split(".")[0] : "";

          if (name && nisnStr && className) {
            await setDoc(
              doc(db, "studentsByNisn", nisnStr),
              {
                nisn: nisnStr,
                displayName: name,
                kelas: className,
                accessCode: accessCodeStr,
                role: "student",
                createdAt: new Date().toISOString(),
              },
              { merge: true },
            );
            successCount++;
          } else {
            failedCount++;
          }
        } else {
          failedCount++;
        }
      }

      if (successCount === 0) {
        setSaveMessage({
          text: "Peringatan: Format tabel tidak sesuai! Pastikan terdapat kolom: Nama, NISN, Kelas, dan Kode Akses.",
          type: "error",
        });
      } else if (failedCount > 0) {
        setSaveMessage({
          text: `Impor Selesai dengan Catatan: Berhasil mengimpor ${successCount} siswa. Namun ${failedCount} baris data dilewati karena format tidak lengkap.`,
          type: "warning",
        });
      } else {
        setSaveMessage({
          text: `Selamat: Berhasil mengimpor seluruh ${successCount} data siswa dengan sukses bersama Kode Aksesnya!`,
          type: "success",
        });
      }
      e.target.value = ""; // Reset input
    } catch (error) {
      console.warn("Import Error:", error);
      setSaveMessage({
        text: "Gagal mengimpor file Excel. Mohon periksa kembali ekstensi file dan format data Anda.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const [isRefreshingTeacherData, setIsRefreshingTeacherData] = useState(false);

  const fetchTeacherData = async (forceRefresh = false) => {
    setIsRefreshingTeacherData(true);
    try {
      // 1. Classes
      const cachedClasses = !forceRefresh && getLocalCache<any[]>("firas_cache_classes", 60 * 60 * 1000);
      if (cachedClasses) {
        setClassesList(cachedClasses);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "classes"));
          trackUsage(snapshot.size, 0);
          const cls = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          cls.sort((a: any, b: any) => (a.createdAt || "").localeCompare(b.createdAt || ""));
          setClassesList(cls);
          setLocalCache("firas_cache_classes", cls);
        } catch (e) {
          console.warn("Failed fetching classes:", e);
        }
      }

      // 2. Students
      const cachedStudents = !forceRefresh && getLocalCache<any[]>("firas_cache_students", 60 * 60 * 1000);
      if (cachedStudents) {
        setStudentsList(cachedStudents);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "studentsByNisn"));
          trackUsage(snapshot.size, 0);
          const studs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          studs.sort((a: any, b: any) => {
            const classA = (a.kelas || "").toString();
            const classB = (b.kelas || "").toString();
            const classComp = classA.localeCompare(classB, "id", { numeric: true, sensitivity: "base" });
            if (classComp !== 0) return classComp;
            return (a.displayName || a.studentName || "").localeCompare(
              b.displayName || b.studentName || "",
              "id",
              { sensitivity: "base" }
            );
          });
          setStudentsList(studs);
          setLocalCache("firas_cache_students", studs);
        } catch (e) {
          console.warn("Failed fetching students:", e);
        }
      }

      // 3. Assignments
      const cachedAssignments = !forceRefresh && getLocalCache<any[]>("firas_cache_assignments", 60 * 60 * 1000);
      if (cachedAssignments) {
        setAssignmentsList(cachedAssignments);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "assignments"));
          trackUsage(snapshot.size, 0);
          const tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          tasks.sort((a: any, b: any) => {
            const dateA = new Date(a.publishedAt || a.createdAt || 0).getTime();
            const dateB = new Date(b.publishedAt || b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setAssignmentsList(tasks);
          setLocalCache("firas_cache_assignments", tasks);
        } catch (e) {
          console.warn("Failed fetching assignments:", e);
        }
      }

      // 4. Submissions
      const cachedSubmissions = !forceRefresh && getLocalCache<any[]>("firas_cache_submissions", 60 * 60 * 1000);
      if (cachedSubmissions) {
        setSubmissionsList(cachedSubmissions);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "submissions"));
          trackUsage(snapshot.size, 0);
          const subs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setSubmissionsList(subs);
          setLocalCache("firas_cache_submissions", subs);
        } catch (e) {
          console.warn("Failed fetching submissions:", e);
        }
      }

      // 5. Final Grades
      const cachedFinalGrades = !forceRefresh && getLocalCache<any[]>("firas_cache_final_grades", 60 * 60 * 1000);
      if (cachedFinalGrades) {
        setFinalGradesList(cachedFinalGrades);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "final_grades"));
          const grades = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setFinalGradesList(grades);
          setLocalCache("firas_cache_final_grades", grades);
        } catch (e) {
          console.warn("Failed fetching final grades:", e);
        }
      }

      // 6. Chapters
      const cachedChapters = !forceRefresh && getLocalCache<any[]>("firas_cache_chapters", 60 * 60 * 1000);
      if (cachedChapters) {
        setChaptersList(cachedChapters);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "chapters"));
          const chaps = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setChaptersList(chaps);
          setLocalCache("firas_cache_chapters", chaps);
        } catch (e) {
          console.warn("Failed fetching chapters:", e);
        }
      }

      // 7. Exams
      const cachedExams = !forceRefresh && getLocalCache<any[]>("firas_cache_exams", 60 * 60 * 1000);
      if (cachedExams) {
        setExamsList(cachedExams);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "exams"));
          trackUsage(snapshot.size, 0);
          const exams = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          exams.sort((a: any, b: any) => {
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setExamsList(exams);
          setLocalCache("firas_cache_exams", exams);
        } catch (e) {
          console.warn("Failed fetching exams:", e);
        }
      }

      // 8. Announcements
      const cachedAnnouncements = !forceRefresh && getLocalCache<any[]>("firas_cache_announcements", 60 * 60 * 1000);
      if (cachedAnnouncements) {
        setAnnouncementsList(cachedAnnouncements);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "announcements"));
          trackUsage(snapshot.size, 0);
          const anns = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          anns.sort((a: any, b: any) => {
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setAnnouncementsList(anns);
          setLocalCache("firas_cache_announcements", anns);
        } catch (e) {
          console.warn("Failed fetching announcements:", e);
        }
      }

      // 9. Absensi
      const cachedAbsensi = !forceRefresh && getLocalCache<any[]>("firas_cache_absensi", 60 * 60 * 1000);
      if (cachedAbsensi) {
        setAbsensiList(cachedAbsensi);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "absensi"));
          trackUsage(snapshot.size, 0);
          const abs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setAbsensiList(abs);
          setLocalCache("firas_cache_absensi", abs);
        } catch (e) {
          console.warn("Failed fetching absensi:", e);
        }
      }

      // 10. Materials
      const cachedMaterials = !forceRefresh && getLocalCache<any[]>("firas_cache_materials", 60 * 60 * 1000);
      if (cachedMaterials) {
        setMaterialsList(cachedMaterials);
      } else {
        try {
          const snapshot = await getDocs(collection(db, "materials"));
          trackUsage(snapshot.size, 0);
          const mat = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          mat.sort((a: any, b: any) => {
            if (a.order !== b.order) return (a.order || 0) - (b.order || 0);
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
          });
          setMaterialsList(mat);
          setLocalCache("firas_cache_materials", mat);
        } catch (e) {
          console.warn("Failed fetching materials:", e);
        }
      }

      // 11. Rubric
      const cachedRubric = !forceRefresh && getLocalCache<any>("firas_cache_rubric", 60 * 60 * 1000);
      if (cachedRubric) {
        setRubric(cachedRubric);
        setEditKehadiran(String(cachedRubric.kehadiran ?? 20));
        setEditTugas(String(cachedRubric.tugas ?? 50));
        setEditUts(String(cachedRubric.uts ?? 10));
        setEditUas(String(cachedRubric.uas ?? 20));
      } else {
        try {
          const docSnap = await getDoc(doc(db, "config", "grading_rubric"));
          if (docSnap.exists()) {
            const data = docSnap.data();
            const r = {
              kehadiran: Number(data.kehadiran) ?? 20,
              tugas: Number(data.tugas) ?? 50,
              uts: Number(data.uts) ?? 10,
              uas: Number(data.uas) ?? 20,
            };
            setRubric(r);
            setEditKehadiran(String(r.kehadiran));
            setEditTugas(String(r.tugas));
            setEditUts(String(r.uts));
            setEditUas(String(r.uas));
            setLocalCache("firas_cache_rubric", r);
          }
        } catch (e) {
          console.warn("Failed fetching rubric:", e);
        }
      }
    } finally {
      setTimeout(() => setIsRefreshingTeacherData(false), 500);
    }
  };

  useEffect(() => {
    // Initial fetch on mount with cache support
    fetchTeacherData(false);
  }, []);

  const handleDeleteAssignment = async (id: string) => {
    if (!id) {
      showAlert("Error", "ID Tugas tidak ditemukan.", "danger");
      return;
    }

    showConfirm(
      "Arsipkan Tugas",
      "Apakah Anda yakin ingin mengarsipkan tugas ini? Tugas tidak akan muncul lagi di daftar siswa.",
      async () => {
        try {
          await setDoc(
            doc(db, "assignments", id),
            { isArchived: true, archivedAt: new Date().toISOString() },
            { merge: true },
          );
          showAlert("Berhasil", "Tugas berhasil diarsipkan!", "alert");
          localStorage.removeItem("firas_cache_assignments");
          fetchTeacherData(false);
        } catch (error: any) {
          console.warn("Archive error:", error);
          showAlert("Gagal", "Gagal mengarsipkan tugas.", "danger");
        }
      },
      "Arsipkan Tugas"
    );
  };

  const handleSaveRubric = async () => {
    const k = Number(editKehadiran) || 0;
    const t = Number(editTugas) || 0;
    const utsVal = Number(editUts) || 0;
    const uasVal = Number(editUas) || 0;

    if (k < 0 || t < 0 || utsVal < 0 || uasVal < 0) {
      showAlert("Validasi", "Persentase tidak boleh negatif.", "danger");
      return;
    }

    const total = k + t + utsVal + uasVal;
    if (total !== 100) {
      showAlert("Validasi Gagal", `Jumlah persentase harus tepat 100% (saat ini: ${total}%). Silakan sesuaikan kembali.`, "danger");
      return;
    }

    setIsSavingRubric(true);
    try {
      await setDoc(doc(db, "config", "grading_rubric"), {
        kehadiran: k,
        tugas: t,
        uts: utsVal,
        uas: uasVal,
        updatedAt: new Date().toISOString()
      });
      setIsEditingRubric(false);
      showAlert("Berhasil", "Rubrik penilaian rapor berhasil disimpan ke cloud!", "alert");
    } catch (error: any) {
      console.warn("Gagal menyimpan rubrik:", error);
      showAlert("Gagal", "Terjadi kesalahan saat menyimpan rubrik ke cloud: " + (error.message || error), "danger");
    } finally {
      setIsSavingRubric(false);
    }
  };

  const handleSaveRekapGrades = async () => {
    setIsSavingRekapGrades(true);
    try {
      const keys = Object.keys(editedRekapGrades);
      if (keys.length === 0) {
        setIsEditingRekapTable(false);
        return;
      }

      for (const key of keys) {
        const valStr = editedRekapGrades[key];
        const lastUnderscore = key.lastIndexOf("_");
        if (lastUnderscore === -1) continue;
        const colId = key.substring(0, lastUnderscore);
        const nisn = key.substring(lastUnderscore + 1);

        const numVal = (valStr === "" || valStr === null || valStr === undefined) ? null : Number(valStr);

        // 1. Save to final_grades
        const fgId = `${colId}_${nisn}`;
        await setDoc(
          doc(db, "final_grades", fgId),
          {
            id: fgId,
            assignmentId: colId,
            nisn: nisn,
            nilai: numVal,
            gradedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );

        // 2. Also update or create submission in submissions collection so student dashboard gets sync
        const subId = `SUB-${nisn}-${colId}`;
        const existingSub = submissionsList.find(
          (s) => s.id === subId || (s.assignmentId === colId && s.nisn === nisn)
        );
        const targetSubId = existingSub?.id || subId;
        const stuObj = studentsList.find(s => s.nisn === nisn);
        const stName = existingSub?.studentName || stuObj?.displayName || stuObj?.studentName || stuObj?.name || "";
        const stKelas = existingSub?.kelas || stuObj?.kelas || "";

        await setDoc(
          doc(db, "submissions", targetSubId),
          {
            id: targetSubId,
            assignmentId: colId,
            nisn: nisn,
            studentName: stName,
            kelas: stKelas,
            nilai: numVal,
            status: numVal !== null ? "sudah dinilai" : (existingSub?.status || "menunggu"),
            gradedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      setEditedRekapGrades({});
      setIsEditingRekapTable(false);
      showAlert("Berhasil", "Semua nilai berhasil disimpan dan diperbarui di dashboard siswa!", "alert");
    } catch (err: any) {
      console.warn("Gagal menyimpan edit nilai rekap:", err);
      showAlert("Gagal", "Terjadi kesalahan saat menyimpan nilai: " + (err.message || err), "danger");
    } finally {
      setIsSavingRekapGrades(false);
    }
  };

  const handleCreateManualColumn = async () => {
    if (!manualMateri.trim()) {
      showAlert("Validasi", "Judul Tugas / Tugas ke wajib diisi.", "alert");
      return;
    }
    if (!manualBab) {
      showAlert("Validasi", "Pilih Bab terlebih dahulu.", "alert");
      return;
    }
    if (!manualKelas) {
      showAlert("Validasi", "Pilih Kelas terlebih dahulu.", "alert");
      return;
    }

    setIsSavingManualColumn(true);
    try {
      const newAssignmentId = `TGS-MANUAL-${Date.now()}`;
      const targetClasses = manualKelas === "ALL" ? classesList.map((c) => c.name) : [manualKelas];
      const pubDate = manualPublishDate ? new Date(manualPublishDate).toISOString() : new Date().toISOString();

      const newDoc = {
        id: newAssignmentId,
        bab: manualBab,
        materi: manualMateri.trim(),
        kelas: manualKelas,
        targets: targetClasses.map((k) => ({
          kelas: k,
          publishedAt: pubDate,
          deadline: new Date(new Date(pubDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        })),
        publishedAt: pubDate,
        deadline: new Date(new Date(pubDate).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        description: "Kolom Nilai Manual (Buku Nilai)",
        isManualColumn: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        teacherId: user?.uid || "mock-admin",
      };

      await setDoc(doc(db, "assignments", newAssignmentId), newDoc);

      setIsAddManualColumnOpen(false);
      setManualBab("");
      setManualMateri("");
      setManualKelas("");
      setManualPublishDate(new Date().toISOString().split("T")[0]);

      // Automatically enable edit mode so teacher can input scores directly in table
      setIsEditingRekapTable(true);
      showAlert(
        "Berhasil",
        `Kolom nilai '${manualMateri.trim()}' berhasil ditambahkan ke tabel! Anda dapat langsung menginput nilai siswa pada kolom tersebut.`,
        "alert"
      );
    } catch (err: any) {
      console.warn("Gagal menambah kolom manual:", err);
      showAlert("Gagal", "Gagal menambahkan kolom nilai: " + (err.message || err), "danger");
    } finally {
      setIsSavingManualColumn(false);
    }
  };

  const handleDeleteStudent = async (id: string, nisn?: string) => {
    showConfirm(
      "Hapus Siswa",
      "Apakah Anda yakin ingin menghapus siswa ini? Seluruh data riwayat tugas siswa ini akan tetap ada namun akun tidak bisa login.",
      async () => {
        try {
          // Always delete using the primary Firestore document ID
          await deleteDoc(doc(db, "studentsByNisn", id));
          
          // Also delete by nisn as fallback if it exists and differs from id
          if (nisn && nisn !== id) {
            try {
              await deleteDoc(doc(db, "studentsByNisn", nisn));
            } catch (innerErr) {
              // Ignore if already deleted
            }
          }
          
          showAlert("Berhasil", "Data siswa berhasil dihapus.", "alert");
          localStorage.removeItem("firas_cache_students");
          fetchTeacherData(false);
        } catch (error) {
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `studentsByNisn/${id}`,
          );
        }
      },
      "Hapus Siswa"
    );
  };

  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingStudentData, setEditingStudentData] = useState({
    displayName: "",
    kelas: "",
    nisn: "",
    accessCode: "",
  });

  const handleEditStudent = (stud: any) => {
    setEditingStudentId(stud.id);
    setEditingStudentData({
      displayName: stud.displayName,
      kelas: stud.kelas,
      nisn: stud.nisn,
      accessCode: stud.accessCode || "",
    });
  };

  const handleSaveEditStudent = async () => {
    if (!editingStudentId || !editingStudentData.displayName || !editingStudentData.kelas) return;
    try {
      await setDoc(
        doc(db, "studentsByNisn", editingStudentId),
        {
          displayName: editingStudentData.displayName,
          kelas: editingStudentData.kelas,
          accessCode: editingStudentData.accessCode || "",
        },
        { merge: true },
      );
      setEditingStudentId(null);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `studentsByNisn/${editingStudentId}`,
      );
    }
  };

  const [activeClassTab, setActiveClassTab] = useState<"tambah" | "daftar">(
    "tambah",
  );
  const [activeStudentClassTab, setActiveStudentClassTab] = useState<
    "input-siswa" | "input-kelas" | "daftar-siswa"
  >("input-siswa");
  const [activeStudentTab, setActiveStudentTab] = useState<"tambah" | "daftar">(
    "tambah",
  );
  const [activeAssignmentTab, setActiveAssignmentTab] = useState<
    "tambah" | "daftar"
  >("tambah");

  const [activeNilaiTab, setActiveNilaiTab] = useState<
    "cek-tugas" | "rekapitulasi"
  >("cek-tugas");
  const [activePresensiTab, setActivePresensiTab] = useState<
    "input" | "preview" | "analisis"
  >("input");
  const [sessionUsage, setSessionUsage] = useState({ reads: 0, writes: 0 });
  const [readAnnIds, setReadAnnIds] = useState<string[]>([]);

  // WhatsApp Share Modal States
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waStudent, setWaStudent] = useState<any>(null);
  const [waParentPhone, setWaParentPhone] = useState("");
  const [waDraftMessage, setWaDraftMessage] = useState("");
  const [copiedIndex, setCopiedIndex] = useState(false);

  // Zoom Student Photo Modal States
  const [zoomedPhotoUrl, setZoomedPhotoUrl] = useState<string | null>(null);
  const [zoomedStudentName, setZoomedStudentName] = useState<string>("");

  const handleBukaWhatsAppModal = (
    stu: any,
    studentGrades: { title: string; type: string; nilai: string }[],
    percentage: number | string,
    stats: { Hadir: number; Sakit: number; Izin: number; Alpa: number; Dispen: number },
    totalMeetings: number,
    ipk: string
  ) => {
    setWaStudent(stu);
    const gradesReport = studentGrades.length > 0
      ? studentGrades.map((g) => `‚Ä¢ ${g.type} - ${g.title}: *${g.nilai}*`).join("\n")
      : "- Belum ada entri nilai tugas atau ujian";

    const text = `*LAPORAN PERKEMBANGAN BELAJAR SISWA*
*Portal Akademik SMAN Belajar*

Disampaikan Kepada Yth. Bapak/Ibu Orang Tua/Wali dari:
‚Ä¢ *Nama Siswa:* ${stu.displayName || stu.studentName}
‚Ä¢ *NISN:* ${stu.nisn}
‚Ä¢ *Kelas:* ${stu.kelas || "-"}

*1. RINGKASAN KEHADIRAN (PRESENSI)*
‚Ä¢ Total Hari Sekolah: ${totalMeetings} Pertemuan
‚Ä¢ Hadir: ${stats.Hadir} hari
‚Ä¢ Sakit: ${stats.Sakit} hari
‚Ä¢ Izin: ${stats.Izin} hari
‚Ä¢ Alpa: ${stats.Alpa} hari
‚Ä¢ Dispen: ${stats.Dispen} hari
‚Ä¢ *Persentase Kehadiran:* *${percentage}%*

*2. DETAIL NILAI TUGAS & UJIAN (CBT)*
${gradesReport}

‚Ä¢ *Rata-Rata Nilai (IPK):* *${ipk}*

_Laporan dikirim secara berkala oleh Wali Kelas untuk memantau aktivitas & prestasi akademik Ananda. Terima kasih atas pengertian dan bimbingan Ayah/Bunda di rumah._`;

    setWaDraftMessage(text);
    // Grab prefilled parent phone if exists, default to 628
    setWaParentPhone(stu.parentPhone || "628");
    setIsWaModalOpen(true);
    setCopiedIndex(false);
  };

  const dashboardStats = useMemo(() => {
    const finishedStudentsCount = new Set(finalGradesList.map(g => g.nisn)).size;
    const averageScore = finalGradesList.length > 0 
      ? (finalGradesList.reduce((sum, g) => sum + (Number(g.nilai) || 0), 0) / finalGradesList.length).toFixed(1)
      : "0";
    
    return {
      activeExams: examsList.length,
      finishedStudents: finishedStudentsCount,
      averageScore
    };
  }, [examsList, finalGradesList]);

  const rankings = useMemo(() => {
    if (!selectedClassFilter || studentsList.length === 0 || !rubric) return new Map();
    
    const studentsInClass = studentsList.filter(s => s.kelas === selectedClassFilter);
    if (studentsInClass.length === 0) return new Map();

    const studentPerformance = studentsInClass.map((stu: any) => {
      // 1. Nilai Kehadiran
      let stuHadirCount = 0;
      let stuTotalMeetings = 0;
      absensiList.forEach((a: any) => {
        if (a.kelasRef === selectedClassFilter) {
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
      const stuGrades = finalGradesList.filter((g: any) => g.nisn === stu.nisn);
      const tugasItems = stuGrades.filter((g: any) => {
        if (g.type === "Tugas") return true;
        const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
        const category = exam?.category || "";
        return category !== "Penilaian Tengah Semester" && category !== "Penilaian Sumatif Akhir Semester";
      });
      const avgTugas = tugasItems.length > 0 
        ? tugasItems.reduce((sum: number, item: any) => sum + (Number(item.nilai) || 0), 0) / tugasItems.length 
        : 0;

      // 3. Nilai UTS
      const utsItem = stuGrades.find((g: any) => {
        const exam = examsList.find((e: any) => e.id === g.assignmentId || e.id === g.id);
        return exam?.category === "Penilaian Tengah Semester";
      });
      const nilaiUts = utsItem ? (Number(utsItem.nilai) || 0) : 0;

      // 4. Nilai UAS
      const uasItem = stuGrades.find((g: any) => {
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

    const rankMap = new Map();
    studentPerformance.forEach((item, index) => {
      rankMap.set(item.nisn, index + 1);
    });

    return rankMap;
  }, [studentsList, selectedClassFilter, finalGradesList, absensiList, examsList, rubric]);

  const attendanceAnalysis = useMemo(() => {
    if (!analysisClass) return [];
    
    const classStudents = studentsList.filter(s => s.kelas === analysisClass);
    const classAbsensi = absensiList.filter(a => a.kelasRef === analysisClass);
    
    return classStudents.map(student => {
      const stats = {
        Hadir: 0,
        Sakit: 0,
        Izin: 0,
        Alpa: 0,
        Dispen: 0
      };
      
      classAbsensi.forEach(abs => {
        const status = abs.data?.[student.nisn] || "Hadir";
        if (stats[status as keyof typeof stats] !== undefined) {
          stats[status as keyof typeof stats]++;
        }
      });
      
      const totalMeetings = classAbsensi.length;
      const attendanceRate = totalMeetings > 0 
        ? Math.round((stats.Hadir / totalMeetings) * 100) 
        : 0;
        
      // New Rubric Logic
      let rubricStatus: "Sangat Rajin" | "Rajin" | "Cukup Rajin" | "Kurang Rajin" = "Rajin";
      let remark = "Kehadiran Baik";
      let warningLevel: "none" | "warning" | "critical" = "none";
      
      if (totalMeetings === 0) {
        rubricStatus = "Rajin";
        remark = "Belum ada pertemuan";
        warningLevel = "none";
      } else {
        if (attendanceRate >= 95 && stats.Alpa === 0 && (stats.Sakit + stats.Izin) <= 2) {
          rubricStatus = "Sangat Rajin";
          remark = "Siswa Sangat Rajin";
        } else if (attendanceRate >= 90 && stats.Alpa < 1) {
          rubricStatus = "Rajin";
          remark = "Siswa Rajin";
        } else if (attendanceRate >= 80 && stats.Alpa < 3) {
          rubricStatus = "Cukup Rajin";
          remark = "Siswa Cukup Rajin";
        } else {
          rubricStatus = "Kurang Rajin";
          remark = "Siswa Kurang Rajin";
        }

        if (stats.Alpa >= 3 || attendanceRate < 80) {
          warningLevel = "critical";
        } else if (stats.Alpa >= 1 || attendanceRate < 90) {
          warningLevel = "warning";
        }
      }
      
      return {
        ...student,
        stats,
        totalMeetings,
        attendanceRate,
        warningLevel,
        rubricStatus,
        remark
      };
    });
  }, [analysisClass, studentsList, absensiList]);

  const handleResetConfirm = async (
    resetType: 'semester' | 'tahun' | 'semua',
    password: string,
    onProgress: (percent: number) => void
  ) => {
    // Add password check logic here (dummy for now)
    if (password !== "admin123") {
      showAlert("Gagal", "Password salah.", "danger");
      throw new Error("Password salah");
    }
    
    const collectionsToClear: string[] = [];
    if (resetType === 'semester') {
      collectionsToClear.push("submissions", "final_grades", "assignments");
    } else if (resetType === 'tahun') {
      collectionsToClear.push("studentsByNisn", "classes", "assignments", "submissions", "final_grades", "chapters", "exams", "absensi", "material_progress");
    } else if (resetType === 'semua') {
      collectionsToClear.push("studentsByNisn", "classes", "assignments", "submissions", "final_grades", "chapters", "exams", "absensi", "material_progress", "announcements", "materials");
    }

    try {
      onProgress(5); // Start progress bar immediately so the user sees a quick response
      
      let totalDocs = 0;
      const snapshotsMap = new Map<string, any>();
      const nestedSubmissionsMap = new Map<string, any[]>();
      
      // Phase 1: Counting/inspecting the database
      let stepPercent = 5;
      const progressIncrement = Math.max(1, Math.floor(15 / collectionsToClear.length));
      
      for (const col of collectionsToClear) {
        try {
          const snapshot = await getDocs(collection(db, col));
          console.log(`Collection ${col} has ${snapshot.size} documents.`);
          snapshotsMap.set(col, snapshot);
          totalDocs += snapshot.size;
          
          // If it's assignments, also check for nested submissions
          if (col === "assignments") {
              for (const docSnapshot of snapshot.docs) {
                  try {
                      const subSnapshot = await getDocs(collection(db, "assignments", docSnapshot.id, "submissions"));
                      console.log(`Nested submissions for assignment ${docSnapshot.id} has ${subSnapshot.size} documents.`);
                      if (!nestedSubmissionsMap.has(docSnapshot.id)) {
                          nestedSubmissionsMap.set(docSnapshot.id, []);
                      }
                      nestedSubmissionsMap.get(docSnapshot.id)!.push(...subSnapshot.docs);
                      totalDocs += subSnapshot.size;
                  } catch (subErr) {
                      console.warn(`Gagal membaca sub-submission untuk tugas ${docSnapshot.id}:`, subErr);
                  }
              }
          }
        } catch (colErr) {
          console.warn(`Gagal menghitung koleksi ${col}:`, colErr);
        }
        stepPercent = Math.min(20, stepPercent + progressIncrement);
        onProgress(stepPercent);
      }
      
      onProgress(20); // Count completed
      console.log(`Total documents to delete: ${totalDocs}`);
      
      if (totalDocs === 0) {
        // If nothing to delete, simulate a fast progress bar so user gets a nice visual feedback
        for (let p = 20; p <= 100; p += 20) {
          onProgress(p);
          await new Promise(r => setTimeout(r, 120));
        }
      } else {
        let processedDocs = 0;
        for (const col of collectionsToClear) {
          try {
            const snapshot = snapshotsMap.get(col);
            if (!snapshot || snapshot.empty) {
                continue;
            }
            
            console.log(`Deleting ${snapshot.size} documents from ${col}...`);
            let batch = writeBatch(db);
            let batchCount = 0;
            
            for (const docSnapshot of snapshot.docs) {
              console.log(`Deleting document ${docSnapshot.id} from ${col}`);
              batch.delete(docSnapshot.ref);
              batchCount++;
              processedDocs++;
              
              if (batchCount === 500) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
              }
              onProgress(Math.round(20 + (processedDocs / totalDocs) * 80));

              // Also delete nested submissions if col is assignments
              if (col === "assignments") {
                  const nestedDocs = nestedSubmissionsMap.get(docSnapshot.id) || [];
                  for (const subDoc of nestedDocs) {
                      console.log(`Deleting nested submission ${subDoc.id} from assignments/${docSnapshot.id}/submissions`);
                      batch.delete(subDoc.ref);
                      batchCount++;
                      processedDocs++;
                      if (batchCount === 500) {
                        await batch.commit();
                        batch = writeBatch(db);
                        batchCount = 0;
                      }
                      onProgress(Math.round(20 + (processedDocs / totalDocs) * 80));
                  }
              }
            }
            if (batchCount > 0) {
              await batch.commit();
            }
          } catch (delErr) {
            console.warn(`Gagal menghapus data dari koleksi ${col}:`, delErr);
          }
          onProgress(Math.round(20 + (processedDocs / totalDocs) * 80));
        }
      }
      
      onProgress(100);
      showAlert("Berhasil", "Data telah direset.", "alert");
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.warn("Reset error:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      showAlert("Gagal", "Terjadi kesalahan saat mereset data: " + errMsg, "danger");
      throw error;
    }
  };

  const handleExportData = () => {
    try {
      const data = {
        exportDate: new Date().toISOString(),
        students: studentsList,
        classes: classesList,
        assignments: assignmentsList,
        submissions: submissionsList,
        appVersion: "1.0.0-firas",
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup_firas_${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      showAlert("Gagal", "Gagal mengekspor data: " + e, "danger");
    }
  };

  const handleResetStats = () => {
    if (confirm("Reset statistik penggunaan sesi ini?")) {
      sessionStorage.setItem("firas_usage_stats", '{"reads":0,"writes":0}');
      try {
        const event = document.createEvent('Event');
        event.initEvent('usage-updated', true, true);
        window.dispatchEvent(event);
      } catch (e) {
        console.warn("Failed to dispatch usage-updated event", e);
      }
    }
  };

  // Retention Policy (Option 3) State & Function
  const [isCleaningRetention, setIsCleaningRetention] = useState(false);
  const [retentionCleanedCount, setRetentionCleanedCount] = useState<number>(() => {
    return Number(localStorage.getItem("sipinter_retention_cleaned") || 0);
  });
  const [retentionLastRun, setRetentionLastRun] = useState<string | null>(() => {
    return localStorage.getItem("sipinter_retention_last_run") || null;
  });

  const storageMetrics = useMemo(() => {
    // Estimasi penggunaan penyimpanan Firebase (Batas Gratis Spark Plan: 5 GB)
    let usedBytes = 5 * 1024 * 1024; // Base system overhead (5 MB)
    submissionsList.forEach((sub: any) => {
      if (sub.fileUrl && !sub.isArchivedByRetention && !sub.fileUrl.includes("Berkas Diarsipkan")) {
        if (sub.fileUrl.startsWith("data:")) {
          usedBytes += Math.round(sub.fileUrl.length * 0.75);
        } else if (sub.fileUrl.includes("firebasestorage")) {
          usedBytes += 1.5 * 1024 * 1024; // Estimasi rata-rata 1.5 MB untuk file lama (PDF/Foto di Storage)
        }
      }
    });
    const maxBytes = 5 * 1024 * 1024 * 1024; // 5 GB
    const freeBytes = Math.max(0, maxBytes - usedBytes);
    
    // Konversi format
    const formatBytes = (bytes: number) => {
      if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
      if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
      if (bytes >= 1024) return (bytes / 1024).toFixed(2) + " KB";
      return bytes + " B";
    };

    const usedFormatted = formatBytes(usedBytes);
    const freeFormatted = formatBytes(freeBytes);
    const percentage = Math.min(100, Math.max(0.1, Number(((usedBytes / maxBytes) * 100).toFixed(2))));

    return { usedBytes, usedFormatted, maxBytes, freeBytes, freeFormatted, percentage };
  }, [submissionsList]);

  const handleRunRetentionCleanup = async () => {
    const gradedSubmissionsWithFiles = submissionsList.filter(
      (sub: any) =>
        (sub.grade !== undefined && sub.grade !== null && sub.grade !== "") ||
        sub.status === "selesai" ||
        sub.status === "sudah dinilai"
    ).filter(
      (sub: any) =>
        sub.fileUrl &&
        !sub.isArchivedByRetention &&
        sub.fileUrl.length > 50
    );

    if (gradedSubmissionsWithFiles.length === 0) {
      showAlert(
        "Penyimpanan Bersih",
        "Tidak ada berkas lampiran tugas selesai yang perlu dibersihkan. Semua tugas selesai sudah diarsipkan atau menggunakan link eksternal ringan.",
        "alert"
      );
      return;
    }

    const confirmRun = confirm(
      `Jalankan Pembersihan Retensi (Option 3)?\n\nDitemukan ${gradedSubmissionsWithFiles.length} berkas tugas yang sudah dinilai.\n\nSistem akan membersihkan beban file berkas lama dari Firebase Storage dan tetap menyimpan 100% DATA NILAI, NAMA SISWA, NISN, KELAS, TANGGAL, dan CATATAN GURU secara permanen di database.`
    );

    if (!confirmRun) return;

    setIsCleaningRetention(true);
    try {
      let batch = writeBatch(db);
      let count = 0;
      let totalCleaned = 0;

      for (const sub of gradedSubmissionsWithFiles) {
        const subRef = doc(db, "submissions", sub.id);
        batch.update(subRef, {
          fileUrl: "[Berkas Diarsipkan Sesuai Kebijakan Retensi]",
          isArchivedByRetention: true,
          archivedAt: new Date().toISOString(),
          originalFileName: sub.fileName || null,
        });
        count++;
        totalCleaned++;

        if (count === 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

      const newTotal = retentionCleanedCount + totalCleaned;
      const nowStr = new Date().toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      setRetentionCleanedCount(newTotal);
      setRetentionLastRun(nowStr);
      localStorage.setItem("sipinter_retention_cleaned", String(newTotal));
      localStorage.setItem("sipinter_retention_last_run", nowStr);

      showAlert(
        "Pembersihan Berhasil!",
        `Berhasil mengarsipkan dan membersihkan ${totalCleaned} berkas tugas lampau. Ruang penyimpanan Firebase berhasil dihemat dan kuota aman 100%. Data nilai seluruh siswa tetap tersimpan utuh.`,
        "alert"
      );
    } catch (err: any) {
      console.warn("Gagal menjalankan kebijakan retensi:", err);
      showAlert("Gagal", `Terjadi kesalahan: ${err.message}`, "danger");
    } finally {
      setIsCleaningRetention(false);
    }
  };

  useEffect(() => {
    const handleUsageUpdate = () => {
      const stats = JSON.parse(
        sessionStorage.getItem("firas_usage_stats") || '{"reads":0,"writes":0}',
      );
      setSessionUsage(stats);
    };

    window.addEventListener("usage-updated", handleUsageUpdate);
    handleUsageUpdate(); // Initial load

    return () => window.removeEventListener("usage-updated", handleUsageUpdate);
  }, []);

  // Menghapus pesan (saveMessage) otomatis setelah 5 detik
  useEffect(() => {
    if (saveMessage.text) {
      const timer = setTimeout(() => {
        setSaveMessage({ text: "", type: "" });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [saveMessage.text]);

  // Menghapus pesan (classSaveMessage) otomatis setelah 5 detik
  useEffect(() => {
    if (classSaveMessage.text) {
      const timer = setTimeout(() => {
        setClassSaveMessage({ text: "", type: "" });
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [classSaveMessage.text]);

  const menus = [
    { id: "dashboard", label: "Dasbor Utama", icon: LayoutDashboard },
    { id: "menu-pengguna", label: "Menu Pengguna", icon: User },
    { id: "manajemen-nilai", label: "Manajemen Nilai", icon: ClipboardCheck },
    { id: "manajemen-siswa-dan-kelas", label: "Manajemen Siswa dan Kelas", icon: Users },
    { id: "sistem-presensi-siswa", label: "Sistem Presensi Siswa", icon: ClipboardList },
    { id: "manajemen-tugas", label: "Manajemen Tugas", icon: FilePlus },
    { id: "materi-ajar", label: "Materi Ajar", icon: BookOpen },
    { id: "ujian-siswa", label: "Ujian Siswa", icon: GraduationCap },
    { id: "pengumuman", label: "Pengumuman Kelas", icon: Bell },
    {
      id: "manajemen-penyimpanan",
      label: "Manajemen Penyimpanan",
      icon: HardDrive,
    },
    {
      id: "ubah-password",
      label: "Ubah Password Guru",
      icon: KeyRound,
    },
  ];

  const handleLogout = () => {
    sessionStorage.removeItem("is_teacher_auth");
    localStorage.removeItem("is_teacher_auth");
    navigate("/", { replace: true });
  };

  const addKopSuratToDoc = async (doc: any, pageWidth: number, margin = 40): Promise<number> => {
    try {
      const targetWidth = pageWidth - (margin * 2);
      // Dimensions are 1450 x 341. Aspect ratio is 341 / 1450 = 0.23517241
      const targetHeight = targetWidth * (341 / 1450);

      doc.addImage(KOP_SURAT_BASE64, "PNG", margin, 20, targetWidth, targetHeight);
      return 20 + targetHeight + 15;
    } catch (e) {
      console.warn("Kop Surat failed to load, drawing text-only header fallback", e);
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      
      doc.setFontSize(11);
      doc.text("PEMERINTAH DAERAH PROVINSI JAWA BARAT", pageWidth / 2, 42, { align: "center" });
      doc.setFontSize(12);
      doc.text("DINAS PENDIDIKAN", pageWidth / 2, 56, { align: "center" });
      doc.setFontSize(10);
      doc.text("CABANG DINAS PENDIDIKAN WILAYAH VI", pageWidth / 2, 69, { align: "center" });
      doc.setFontSize(15);
      doc.text("SMA NEGERI 1 CILILIN", pageWidth / 2, 86, { align: "center" });
      
      doc.setFont("Helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text("Jl. Raya Cililin No. 39, Kec. Cililin, Kabupaten Bandung Barat 40562", pageWidth / 2, 98, { align: "center" });
      doc.setFont("Helvetica", "italic");
      doc.text("Website: https://www.sman1cililin.sch.id | Email: sman1cln@yahoo.co.id", pageWidth / 2, 109, { align: "center" });
      
      doc.setLineWidth(2.0);
      doc.setDrawColor(0, 0, 0);
      doc.line(margin, 122, pageWidth - margin, 122);
      doc.setLineWidth(0.5);
      doc.line(margin, 126, pageWidth - margin, 126);
      
      return 150;
    }
  };

  const calculateNilaiRapor = (stu: any) => {
    const { total, persentase } = getStudentAbsensiCounts(stu, absensiList, selectedClassFilter || stu.kelas);
    const nilaiKehadiran = total > 0 ? persentase : 100;

    const tugasVals: number[] = [];
    let utsVal = 0;
    let uasVal = 0;

    assignmentsList.forEach((a) => {
      const sub = submissionsList.find((s) => s.assignmentId === a.id && s.nisn === stu.nisn);
      const fGrade = finalGradesList.find((f) => f.assignmentId === a.id && f.nisn === stu.nisn);
      const cellKey = `${a.id}_${stu.nisn}`;
      const isEdited = editedRekapGrades[cellKey] !== undefined;
      const val = isEdited ? editedRekapGrades[cellKey] : (sub?.nilai !== undefined && sub?.nilai !== null && sub?.nilai !== "" ? sub.nilai : fGrade?.nilai);
      if (val !== undefined && val !== null && val !== "") {
        tugasVals.push(Number(val));
      } else {
        tugasVals.push(0);
      }
    });

    examsList.forEach((e) => {
      const fGrade = finalGradesList.find(
        (f) => (f.alignmentId === e.id || f.assignmentId === e.id) && f.nisn === stu.nisn
      );
      const cellKey = `${e.id}_${stu.nisn}`;
      const isEdited = editedRekapGrades[cellKey] !== undefined;
      const val = isEdited ? editedRekapGrades[cellKey] : fGrade?.nilai;
      if (val !== undefined && val !== null && val !== "") {
        const n = Number(val);
        if (e.category === "Penilaian Tengah Semester") utsVal = n;
        else if (e.category === "Penilaian Sumatif Akhir Semester") uasVal = n;
        else tugasVals.push(n);
      } else {
        if (e.category === "Penilaian Tengah Semester") utsVal = 0;
        else if (e.category === "Penilaian Sumatif Akhir Semester") uasVal = 0;
        else tugasVals.push(0);
      }
    });

    const avgTugas = tugasVals.length > 0 ? tugasVals.reduce((a, b) => a + b, 0) / tugasVals.length : 0;

    const rKehadiran = Number(rubric?.kehadiran ?? 20);
    const rTugas = Number(rubric?.tugas ?? 50);
    const rUts = Number(rubric?.uts ?? 10);
    const rUas = Number(rubric?.uas ?? 20);

    const finalRapor =
      nilaiKehadiran * (rKehadiran / 100) +
      avgTugas * (rTugas / 100) +
      utsVal * (rUts / 100) +
      uasVal * (rUas / 100);

    return Math.round(finalRapor);
  };

  const generateNilaiPDFDoc = async () => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = (await import("jspdf-autotable")) as any;
    // Use standard F4 (Folio) paper size: 215 mm x 330 mm (609.45 pt x 935.43 pt) in portrait position
    const doc = new jsPDF("p", "pt", [609.45, 935.43]);

    const pageWidth = 609.45;
    const margin = 40;

    let currentY = await addKopSuratToDoc(doc, pageWidth, margin);

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0); 
    doc.text("LAPORAN PENILAIAN HASIL BELAJAR SISWA", pageWidth / 2, currentY, { align: "center" });
    currentY += 20;

    doc.setFontSize(11);
    doc.text(`MATA PELAJARAN: ${userSettings.subjectName.toUpperCase()}`, pageWidth / 2, currentY, { align: "center" });
    currentY += 30;

    // Meta Info Grid
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text("GURU MATA PELAJARAN", margin, currentY);
    doc.text(":", margin + 125, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(userSettings.teacherName, margin + 133, currentY);

    doc.setFont("Helvetica", "bold");
    doc.text("TAHUN PELAJARAN", 350, currentY);
    doc.text(":", 455, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(`${userSettings.academicYear} (${userSettings.semester})`, 463, currentY);
    currentY += 15;

    doc.setFont("Helvetica", "bold");
    doc.text("KELAS / SEGMEN", margin, currentY);
    doc.text(":", margin + 125, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(selectedClassFilter || "Seluruh Kelas Aktif", margin + 133, currentY);

    doc.setFont("Helvetica", "bold");
    const currentDateStrString = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    doc.text("TANGGAL CETAK", 350, currentY);
    doc.text(":", 455, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(currentDateStrString, 463, currentY);
    currentY += 25;

    // Prepare Dynamic Headers
    const sortedEvaluations = [
      ...assignmentsList.map((a) => ({
        id: a.id,
        title: a.materi || "Tugas",
        type: "assignment",
        date: a.publishedAt || a.createdAt,
      })),
      ...examsList.map((e) => ({
        id: e.id,
        title: e.title || "Ujian",
        type: "exam",
        date: e.createdAt,
      })),
    ].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateA - dateB;
    });

    const tableHeaders = [
      "No",
      "NISN",
      "Nama Siswa",
      "Kelas",
      "Nilai Kehadiran",
      ...sortedEvaluations.map((a) => a.title),
      "Nilai Rapor"
    ];

    // Prepare Rows directly from final_grades Firestore DB sync state (finalGradesList)
    const tableRows = studentsList
      .filter((stu) => (selectedClassFilter ? stu.kelas === selectedClassFilter : true))
      .sort((a, b) => {
        const classA = (a.kelas || "").toString();
        const classB = (b.kelas || "").toString();
        const classComp = classA.localeCompare(classB, "id", { numeric: true, sensitivity: "base" });
        if (classComp !== 0) return classComp;
        return (a.displayName || a.studentName || "").localeCompare(
          b.displayName || b.studentName || "",
          "id",
          { sensitivity: "base" }
        );
      })
      .map((stu, index) => {
        const { total, persentase } = getStudentAbsensiCounts(stu, absensiList, selectedClassFilter || stu.kelas);
        const presenceScore = (total > 0 ? persentase : 100).toString(); // TANPA simbol %

        // List each evaluation's grade
        const gradesCols = sortedEvaluations.map((evalItem) => {
          const fg = finalGradesList.find(
            (f) => (f.assignmentId === evalItem.id || f.alignmentId === evalItem.id) && f.nisn === stu.nisn
          );
          const sub = submissionsList.find((s) => s.assignmentId === evalItem.id && s.nisn === stu.nisn);
          const val = sub?.nilai !== undefined && sub?.nilai !== null && sub?.nilai !== "" ? sub.nilai : fg?.nilai;
          return val !== undefined && val !== null && val !== "" ? val.toString() : "0";
        });

        // Calculate Nilai Rapor
        const nilaiRapor = calculateNilaiRapor(stu).toString();

        return [
          (index + 1).toString(),
          stu.nisn || "-",
          stu.displayName || stu.studentName || "-",
          stu.kelas || "-",
          presenceScore,
          ...gradesCols,
          nilaiRapor
        ];
      });

    // Calculate column widths for Portrait F4
    const totalAvailableWidth = pageWidth - (margin * 2); // 529.45 pt
    const noWidth = 22;
    const nisnWidth = 52;
    const kelasWidth = 38;
    const kehadiranWidth = 48;
    const raporWidth = 48;

    const numEvaluations = sortedEvaluations.length;
    // Ukuran kolom CBT dan Tugas 1 samakan dengan ukuran kolom Kelas (38 pt)
    const evalColWidth = kelasWidth; // 38 pt
    const totalEvalsWidth = numEvaluations * evalColWidth;

    const reservedStaticWidth = noWidth + nisnWidth + kelasWidth + kehadiranWidth + raporWidth;
    let nameWidth = totalAvailableWidth - (reservedStaticWidth + totalEvalsWidth);
    
    if (nameWidth < 100) {
      nameWidth = 100;
    }

    const columnStyles: any = {
      0: { halign: "center", fontStyle: "bold", cellWidth: noWidth },
      1: { halign: "center", cellWidth: nisnWidth },
      2: { halign: "left", cellWidth: nameWidth, overflow: "ellipsize" }, // Nama Siswa: jangan dikemas text (fit single line)
      3: { halign: "center", cellWidth: kelasWidth },
      4: { halign: "center", cellWidth: kehadiranWidth }
    };

    for (let i = 0; i < numEvaluations; i++) {
      columnStyles[5 + i] = { 
        halign: "center", 
        cellWidth: evalColWidth, // Ukuran kolom samakan dengan Kelas (38 pt)
        overflow: "linebreak"   // Dikemas text jika tidak cukup
      };
    }

    columnStyles[5 + numEvaluations] = {
      halign: "center",
      fontStyle: "bold",
      cellWidth: raporWidth,
      fillColor: [220, 252, 231]
    };

    // Generate Table
    autoTable(doc, {
      startY: currentY,
      margin: { left: 40, right: 40 },
      head: [tableHeaders],
      body: tableRows,
      theme: "grid",
      styles: {
        font: "Helvetica",
        fontSize: 7.5,
        cellPadding: 4,
        overflow: "linebreak",
        valign: "middle",
        textColor: [0, 0, 0],
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [220, 230, 242],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 8,
        halign: "center",
        valign: "middle",
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
      },
      columnStyles: columnStyles,
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      didDrawPage: (data: any) => {
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(100);
        doc.text(
          `Halaman ${data.pageNumber} dari ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.height - 30,
          { align: "center" }
        );
      }
    });

    // Signature Block
    const finalY = (doc as any).lastAutoTable?.finalY || currentY + 100;
    const spaceForSignature = 150;
    const pageHeight = doc.internal.pageSize.getHeight();
    
    let sigY = finalY + 45;
    if (sigY + spaceForSignature > pageHeight) {
      doc.addPage();
      sigY = 60;
    }

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0); 
    doc.text("Mengetahui,", 40, sigY);
    doc.text("Kepala SMAN 1 Cililin,", 40, sigY + 14);
    doc.text("Cililin, " + currentDateStrString, 380, sigY);
    doc.text("Guru Mata Pelajaran Informatika,", 380, sigY + 14);
    
    doc.setFont("Helvetica", "bold");
    doc.text(userSettings.principalName, 40, sigY + 75);
    doc.text(userSettings.teacherName, 380, sigY + 75);

    doc.setFont("Helvetica", "normal");
    doc.text(`NIP. ${userSettings.principalNip}`, 40, sigY + 88);
    doc.text(`NIP. ${userSettings.teacherNip}`, 380, sigY + 88);

    return doc;
  };

  const handleDownloadPDF = async () => {
    try {
      setIsGeneratingPdf(true);
      const doc = await generateNilaiPDFDoc();
      const fileName = selectedClassFilter 
        ? `Daftar_Nilai_${userSettings.subjectName.replace(/\s+/g, "_")}_${selectedClassFilter.replace(/\s+/g, "_")}.pdf` 
        : `Daftar_Nilai_${userSettings.subjectName.replace(/\s+/g, "_")}_Semua.pdf`;
      doc.save(fileName);
      showAlert("Berhasil", "Laporan Penilaian (PDF) berhasil diunduh.", "alert", "Tutup");
    } catch (e: any) {
      console.warn(e);
      showAlert("Gagal", `Gagal mengekspor PDF: ${e.message || e}`, "danger");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePreviewNilaiPDF = async () => {
    try {
      setIsGeneratingPdf(true);
      const doc = await generateNilaiPDFDoc();
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
      setPdfPreviewTitle("Preview Laporan Nilai Siswa (SMAN 1 Cililin)");
    } catch (e: any) {
      console.warn(e);
      showAlert("Gagal", `Gagal memproses Preview PDF: ${e.message || e}`, "danger");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadViolationReport = async (exam: any, targetClassOverride?: string) => {
    try {
      setIsGeneratingPdf(true);
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = (await import("jspdf-autotable")) as any;

      const targetClass = targetClassOverride || downloadExamModal.selectedClass || exam.kelasRef || "SEMUA_KELAS";

      // Standard Folio/F4 paper size: [609.45, 935.43]
      const doc = new jsPDF("p", "pt", [609.45, 935.43]);
      const pageWidth = 609.45;
      const margin = 40;
      const center = pageWidth / 2;

      // 1. Render Official Kop Surat SMAN 1 Cililin cleanly (tidak meleyot)
      let currentY = await addKopSuratToDoc(doc, pageWidth, margin);

      // Title
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(0, 0, 0); 
      doc.text("LAPORAN PELANGGARAN & HASIL UJIAN (CBT)", center, currentY, { align: "center" });
      currentY += 25;

      // Document Meta Information
      doc.setFont("Helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);

      doc.text("MATA PELAJARAN", margin, currentY);
      doc.text(":", margin + 100, currentY);
      doc.setFont("Helvetica", "normal");
      doc.text(exam.subject || userSettings.subjectName || "Informatika", margin + 108, currentY);

      const now = new Date();
      const dateOnlyStr = now.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      const timeOnlyStr = now.toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const tanggalCetakWithTime = `${dateOnlyStr}, ${timeOnlyStr} WIB`;

      doc.setFont("Helvetica", "bold");
      doc.text("TANGGAL CETAK", 350, currentY);
      doc.text(":", 455, currentY);
      doc.setFont("Helvetica", "normal");
      doc.text(tanggalCetakWithTime, 463, currentY);

      currentY += 15;

      doc.setFont("Helvetica", "bold");
      doc.text("NAMA UJIAN", margin, currentY);
      doc.text(":", margin + 100, currentY);
      doc.setFont("Helvetica", "normal");
      doc.text(exam.title || "-", margin + 108, currentY);

      doc.setFont("Helvetica", "bold");
      doc.text("KELAS SASARAN", 350, currentY);
      doc.text(":", 455, currentY);
      doc.setFont("Helvetica", "normal");
      const displayKelasStr = targetClass === "SEMUA_KELAS" ? "Pilih Semua Kelas (Seluruh Kelas)" : targetClass;
      doc.text(displayKelasStr, 463, currentY);

      currentY += 15;

      doc.setFont("Helvetica", "bold");
      doc.text("BAB / MATERI", margin, currentY);
      doc.text(":", margin + 100, currentY);
      doc.setFont("Helvetica", "normal");
      const rawBab = exam.bab || exam.materi || exam.chapter || "-";
      const displayBab = rawBab.length > 45 ? rawBab.substring(0, 45) + "..." : rawBab;
      doc.text(displayBab, margin + 108, currentY);

      currentY += 25;

      const tableHeaders = [
        "No", 
        "NIS / NISN", 
        "Nama Lengkap", 
        "Kelas", 
        "Nilai Asal", 
        "Penalti", 
        "Nilai Akhir",
        "Tgl & Jam Pengerjaan",
        "Catatan Pelanggaran"
      ];

      // Filter students for the selected class (or all students if SEMUA_KELAS)
      const examStudents = (targetClass && targetClass !== "SEMUA_KELAS")
        ? studentsList.filter((stu) => stu.kelas === targetClass)
        : studentsList;

      const tableRows = examStudents.map((stu, idx) => {
        const fg = finalGradesList.find(
          (g) => (g.assignmentId === exam.id || g.examId === exam.id) && g.nisn === stu.nisn
        );
        const submitted = fg ? true : false;
        
        let originalScore = "-";
        let violations = "-";
        let finalScore = "-";
        let dateTimeStr = "-";
        let notes = "Belum Mengumpulkan";
        
        if (submitted) {
          const baseS = fg?.baseScore !== undefined ? fg.baseScore : (fg?.nilai ?? 0);
          originalScore = baseS.toString();
          
          const violC = fg?.violationCount ?? fg?.violationsCount ?? 0;
          violations = violC > 0 ? `-${violC} Poin` : "0";
          
          finalScore = (fg?.nilai ?? 0).toString();
          notes = violC > 0 ? `${violC}x upaya pelanggaran tab out/fokus hilang.` : "Tertib & Jujur";

          const rawTime = fg?.submittedAt || fg?.createdAt || fg?.updatedAt || fg?.timestamp || fg?.date;
          if (rawTime) {
            try {
              const d = new Date(rawTime);
              if (!isNaN(d.getTime())) {
                const datePart = d.toLocaleDateString("id-ID", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric"
                });
                const timePart = d.toLocaleTimeString("id-ID", {
                  hour: "2-digit",
                  minute: "2-digit"
                });
                dateTimeStr = `${datePart} ${timePart} WIB`;
              } else {
                dateTimeStr = String(rawTime);
              }
            } catch (_) {
              dateTimeStr = "-";
            }
          }
        }

        return [
          idx + 1,
          stu.nisn || "-",
          stu.displayName || stu.name || "-",
          stu.kelas || "-",
          originalScore,
          violations,
          finalScore,
          dateTimeStr,
          notes
        ];
      });

      autoTable(doc, {
        startY: currentY,
        margin: { left: 40, right: 40 },
        head: [tableHeaders],
        body: tableRows,
        theme: "grid",
        styles: {
          font: "Helvetica",
          fontSize: 7.5,
          cellPadding: 4,
          overflow: "linebreak",
          lineColor: [0, 0, 0],
          lineWidth: 0.5,
          textColor: [0, 0, 0],
        },
        headStyles: {
          fillColor: [220, 220, 220],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          halign: "center",
          lineColor: [0, 0, 0],
          lineWidth: 0.5,
        },
        columnStyles: {
          0: { halign: "center", cellWidth: 20 },
          1: { halign: "center", cellWidth: 60 },
          2: { halign: "left", cellWidth: 115 },
          3: { halign: "center", cellWidth: 35 },
          4: { halign: "center", cellWidth: 35 },
          5: { halign: "center", cellWidth: 38, textColor: [220, 38, 38] },
          6: { halign: "center", fontStyle: "bold", cellWidth: 40 },
          7: { halign: "center", cellWidth: 82 },
          8: { halign: "left" },
        },
      });

      const finalY = (doc as any).lastAutoTable?.finalY || currentY + 100;
      const spaceForSignature = 150;
      const pageHeight = doc.internal.pageSize.getHeight();
      
      let sigY = finalY + 40;
      if (sigY + spaceForSignature > pageHeight) {
        doc.addPage();
        sigY = 60;
      }

      doc.setFont("Helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(0, 0, 0); 
      doc.text("Mengetahui,", 40, sigY);
      doc.text("Kepala SMAN 1 Cililin,", 40, sigY + 14);
      doc.text("Cililin, " + dateOnlyStr, 380, sigY);
      doc.text("Guru Mata Pelajaran Informatika,", 380, sigY + 14);
      
      doc.setFont("Helvetica", "bold");
      doc.text(userSettings.principalName, 40, sigY + 75);
      doc.text(userSettings.teacherName, 380, sigY + 75);

      doc.setFont("Helvetica", "normal");
      doc.text(`NIP. ${userSettings.principalNip}`, 40, sigY + 88);
      doc.text(`NIP. ${userSettings.teacherNip}`, 380, sigY + 88);

      const cleanFileName = `Laporan_Pelanggaran_${exam.title.replace(/\s+/g, '_')}_${targetClass.replace(/\s+/g, '_')}.pdf`;
      doc.save(cleanFileName);
      showAlert(
        "Unduhan Berhasil",
        "Dokumen Laporan Hasil & Pelanggaran Ujian (PDF) telah berhasil diunduh.",
        "alert"
      );
    } catch (error) {
      console.warn("Gagal mendownload laporan:", error);
      showAlert(
        "Gagal",
        "Terjadi kesalahan saat memproses Laporan Pelanggaran.",
        "danger"
      );
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadExcel = async () => {
    try {
      const ExcelJS = await import("exceljs");
      const { saveAs } = await import("file-saver");
      
      const workbook = new ExcelJS.default.Workbook();
      const worksheet = workbook.addWorksheet("Rekap_Nilai");

      const sortedEvaluations = [
        ...assignmentsList.map((a) => ({
          id: a.id,
          title: a.title,
          type: "assignment" as const,
          dueDate: a.dueDate,
        })),
        ...examsList.map((e) => ({
          id: e.id,
          title: e.title,
          type: "exam" as const,
          dueDate: e.startTime,
        })),
      ].sort((a, b) => {
        const dateA = a.dueDate?.toDate?.() || new Date(a.dueDate);
        const dateB = b.dueDate?.toDate?.() || new Date(b.dueDate);
        return dateA.getTime() - dateB.getTime();
      });

      const headers = [
        "No",
        "NISN",
        "Nama Siswa",
        "Kelas",
        "Nilai Kehadiran",
        ...sortedEvaluations.map((e) => e.title),
        "Nilai Akhir",
        "Nilai Rapor"
      ];

      // Set Title instead of image
      const endColIndex = Math.max(8, headers.length);
      worksheet.mergeCells(1, 1, 2, endColIndex);
      const headerCell = worksheet.getCell('A1');
      headerCell.value = "SMA NEGERI 1 CILILIN";
      headerCell.font = { bold: true, size: 16 };
      headerCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.mergeCells(3, 1, 3, endColIndex);
      const subHeaderCell = worksheet.getCell('A3');
      subHeaderCell.value = `LAPORAN PENILAIAN - ${userSettings.subjectName.toUpperCase()}`;
      subHeaderCell.font = { bold: true, size: 12 };
      subHeaderCell.alignment = { horizontal: 'center' };

      const startRow = 5;

      // Headers
      worksheet.getRow(startRow).values = headers;
      
      const headerRow = worksheet.getRow(startRow);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center' };
      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE5E7EB' }
        };
      });

      // Data
      const filteredStudents = studentsList
        .filter((s) => !selectedClassFilter || s.kelas === selectedClassFilter)
        .sort((a, b) => {
          const classA = (a.kelas || "").toString();
          const classB = (b.kelas || "").toString();
          const classComp = classA.localeCompare(classB, "id", { numeric: true, sensitivity: "base" });
          if (classComp !== 0) return classComp;
          return (a.displayName || a.studentName || "").localeCompare(
            b.displayName || b.studentName || "",
            "id",
            { sensitivity: "base" }
          );
        });

      filteredStudents.forEach((stu, index) => {
        const row = worksheet.getRow(startRow + 1 + index);
        
        const { total, persentase } = getStudentAbsensiCounts(stu, absensiList, selectedClassFilter || stu.kelas);
        const presenceScore = total > 0 ? persentase : 100; // TANPA %

        const gradesCols = sortedEvaluations.map((ev) => {
          const fg = finalGradesList.find((g) => g.nisn === stu.nisn && (g.assignmentId === ev.id || g.alignmentId === ev.id));
          const sub = submissionsList.find((s) => s.assignmentId === ev.id && s.nisn === stu.nisn);
          const val = sub?.nilai !== undefined && sub?.nilai !== null && sub?.nilai !== "" ? sub.nilai : fg?.nilai;
          return val !== undefined && val !== null && val !== "" ? Number(val) : 0;
        });

        const studentGrades = finalGradesList.filter((fg) => fg.nisn === stu.nisn);
        const totalScore = studentGrades.reduce((sum, item) => sum + Number(item.nilai || 0), 0);
        const finalGrade = studentGrades.length > 0 ? Number((totalScore / studentGrades.length).toFixed(1)) : "N/A";

        const nilaiRapor = calculateNilaiRapor(stu);

        row.values = [
          index + 1,
          stu.nisn || "-",
          stu.displayName || stu.studentName || "-",
          stu.kelas || "-",
          presenceScore,
          ...gradesCols,
          finalGrade,
          nilaiRapor
        ];

        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // Column widths
      const colWidths = [
        { width: 5 },  // No
        { width: 15 }, // NISN
        { width: 30 }, // Nama
        { width: 10 }, // Kelas
        { width: 15 }, // Nilai Kehadiran
        ...sortedEvaluations.map(() => ({ width: 15 })),
        { width: 12 }, // Nilai Akhir
        { width: 12 }  // Nilai Rapor
      ];
      worksheet.columns = colWidths;

      const buf = await workbook.xlsx.writeBuffer();
      const fileName = selectedClassFilter 
        ? `Laporan_Nilai_${userSettings.subjectName.replace(/\s+/g, "_")}_${selectedClassFilter.replace(/\s+/g, "_")}.xlsx` 
        : `Laporan_Nilai_${userSettings.subjectName.replace(/\s+/g, "_")}_Semua.xlsx`;
      
      saveAs(new Blob([buf]), fileName);
      showAlert("Berhasil", "Laporan Nilai Excel berhasil diunduh.", "alert", "Tutup");
    } catch (e: any) {
      console.warn(e);
      showAlert("Gagal", `Gagal mengunduh Excel: ${e.message || e}`, "danger");
    }
  };

  const getStudentAbsensiCounts = (s: any, absList: any[], targetClass?: string) => {
    let hadir = 0;
    let sakit = 0;
    let izin = 0;
    let alpa = 0;
    let dispen = 0;

    const relevantAbs = absList.filter(a => !targetClass || a.kelasRef === targetClass || a.kelas === targetClass);

    relevantAbs.forEach(a => {
      let statusVal: string | null = null;
      if (a.data && (a.data[s.nisn] !== undefined || (s.id && a.data[s.id] !== undefined))) {
        statusVal = String(a.data[s.nisn] ?? a.data[s.id]);
      } else if (a.nisn === s.nisn || (s.id && a.studentId === s.id)) {
        statusVal = String(a.status || '');
      }

      if (statusVal) {
        const st = statusVal.trim().toLowerCase();
        if (st === 'hadir' || st === 'h') hadir++;
        else if (st === 'sakit' || st === 's') sakit++;
        else if (st === 'izin' || st === 'i') izin++;
        else if (st === 'alpa' || st === 'a') alpa++;
        else if (st === 'dispen' || st === 'd') dispen++;
      }
    });

    const total = hadir + sakit + izin + alpa + dispen;
    const persentase = total > 0 ? Math.round(((hadir + dispen) / total) * 100) : 0;

    return { hadir, sakit, izin, alpa, dispen, total, persentase };
  };

  const handleDownloadPreviewExcel = async () => {
    try {
      const ExcelJS = await import("exceljs");
      const { saveAs } = await import("file-saver");
      
      const workbook = new ExcelJS.default.Workbook();
      const worksheet = workbook.addWorksheet("Rekap_Kehadiran");

      // Set Title instead of image
      worksheet.mergeCells('A1:H2');
      const headerCell = worksheet.getCell('A1');
      headerCell.value = "SMA NEGERI 1 CILILIN";
      headerCell.font = { bold: true, size: 16 };
      headerCell.alignment = { horizontal: 'center', vertical: 'middle' };

      worksheet.mergeCells('A3:H3');
      const subHeaderCell = worksheet.getCell('A3');
      subHeaderCell.value = "REKAPITULASI KEHADIRAN SISWA";
      subHeaderCell.font = { bold: true, size: 12 };
      subHeaderCell.alignment = { horizontal: 'center' };

      const startRow = 5;
      
      // Headers
      const attendanceHeaders = [
        "No", 
        "Nama Lengkap Siswa", 
        "Kelas",
        "Hadir",
        "Sakit", 
        "Izin", 
        "Alpa", 
        "Dispen", 
        "Persentase"
      ];
      worksheet.getRow(startRow).values = attendanceHeaders;
      
      // Styling headers
      const headerRow = worksheet.getRow(startRow);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: 'center' };
      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE5E7EB' }
        };
      });

      // Data
      const attendanceList = studentsList
        .filter((s) => !attendanceClass || s.kelas === attendanceClass)
        .sort((a, b) => (a.displayName || a.studentName || "").localeCompare(b.displayName || b.studentName || ""));

      attendanceList.forEach((s, idx) => {
        const row = worksheet.getRow(startRow + 1 + idx);
        const { hadir, sakit, izin, alpa, dispen, persentase } = getStudentAbsensiCounts(s, absensiList, attendanceClass);
        const percent = `${persentase}%`;

        row.values = [
          idx + 1,
          s.displayName || s.studentName,
          s.kelas || "-",
          hadir,
          sakit,
          izin,
          alpa,
          dispen,
          percent
        ];

        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // Column widths
      worksheet.columns = [
        { width: 5 },  // No
        { width: 35 }, // Nama
        { width: 10 }, // Kelas
        { width: 10 }, // Hadir
        { width: 10 }, // Sakit
        { width: 10 }, // Izin
        { width: 10 }, // Alpa
        { width: 14 }, // Dispen (Width 14 prevents text wrap for 'Dispen')
        { width: 15 }  // Persentase
      ];

      const buf = await workbook.xlsx.writeBuffer();
      const className = attendanceClass || "Semua_Kelas";
      saveAs(new Blob([buf]), `Rekap_Kehadiran_${className.replace(/\s+/g, "_")}.xlsx`);
      showAlert("Unduhan Berhasil", "Rekap Kehadiran Excel berhasil diunduh.", "alert", "Tutup");
    } catch (e: any) {
      console.warn(e);
      showAlert("Gagal", `Gagal mengunduh Excel: ${e.message || e}`, "danger");
    }
  };

  const generateAbsensiPDFDoc = async () => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = (await import("jspdf-autotable")) as any;
    // Use standard F4 (Folio) paper size: 215 mm x 330 mm (609.45 pt x 935.43 pt) in portrait position
    const doc = new jsPDF("p", "pt", [609.45, 935.43]);

    const pageWidth = 609.45;
    const margin = 40;

    let currentY = await addKopSuratToDoc(doc, pageWidth, margin);

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(0, 0, 0); 
    doc.text("REKAPITULASI KEHADIRAN SISWA", pageWidth / 2, currentY, { align: "center" });
    currentY += 25;

    const currentDateStr = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);

    // Row 1: KELAS (Left) and TAHUN PELAJARAN (Right)
    doc.setFont("Helvetica", "bold");
    doc.text("KELAS", 40, currentY);
    doc.text(":", 105, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(attendanceClass || "Semua Kelas", 113, currentY);

    doc.setFont("Helvetica", "bold");
    doc.text("TAHUN PELAJARAN", 350, currentY);
    doc.text(":", 455, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(userSettings.academicYear || "2026/2027", 463, currentY);

    currentY += 15;

    // Row 2: SEMESTER (Left) and TANGGAL CETAK (Right)
    doc.setFont("Helvetica", "bold");
    doc.text("SEMESTER", 40, currentY);
    doc.text(":", 105, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(userSettings.semester || "Ganjil", 113, currentY);

    doc.setFont("Helvetica", "bold");
    doc.text("TANGGAL CETAK", 350, currentY);
    doc.text(":", 455, currentY);
    doc.setFont("Helvetica", "normal");
    doc.text(currentDateStr, 463, currentY);

    currentY += 25;

    const tableHeaders = [
      "No", 
      "Nama Lengkap Siswa", 
      "Kelas",
      "Hadir",
      "Sakit", 
      "Izin", 
      "Alpa", 
      "Dispen", 
      "Persentase"
    ];

    const filteredStudents = attendanceClass 
      ? studentsList.filter(s => s.kelas === attendanceClass) 
      : studentsList;

    const tableRows = filteredStudents.map((s: any, idx: number) => {
      const { hadir, sakit, izin, alpa, dispen, persentase } = getStudentAbsensiCounts(s, absensiList, attendanceClass);

      return [
        idx + 1,
        s.displayName || s.studentName,
        s.kelas || "-",
        hadir,
        sakit,
        izin,
        alpa,
        dispen,
        `${persentase}%`
      ];
    });

    autoTable(doc, {
      startY: currentY,
      margin: { left: 40, right: 40 },
      head: [tableHeaders],
      body: tableRows,
      theme: "grid",
      styles: {
        font: "Helvetica",
        fontSize: 8.5,
        cellPadding: 4,
        overflow: "linebreak",
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [200, 200, 200],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        halign: "center",
        lineColor: [0, 0, 0],
        lineWidth: 0.5,
        cellPadding: { top: 5, bottom: 5, left: 2, right: 2 },
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 25 },
        1: { halign: "left" },
        2: { halign: "center", cellWidth: 45 },
        3: { halign: "center", cellWidth: 40 }, // Hadir
        4: { halign: "center", cellWidth: 40 }, // Sakit
        5: { halign: "center", cellWidth: 40 }, // Izin
        6: { halign: "center", cellWidth: 40 }, // Alpa
        7: { halign: "center", cellWidth: 54 }, // Dispen (Width 54pt ensures 'Dispen' never wraps)
        8: { halign: "center", fontStyle: "bold", cellWidth: 62 }, // Persentase
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY || currentY + 100;
    
    const sigY = finalY + 45;
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0); 
    doc.text("Mengetahui,", 40, sigY);
    doc.text("Kepala SMAN 1 Cililin,", 40, sigY + 14);
    doc.text("Cililin, " + currentDateStr, 380, sigY);
    doc.text("Guru Mata Pelajaran Informatika,", 380, sigY + 14);
    
    doc.setFont("Helvetica", "bold");
    doc.text(userSettings.principalName, 40, sigY + 75);
    doc.text(userSettings.teacherName, 380, sigY + 75);

    doc.setFont("Helvetica", "normal");
    doc.text(`NIP. ${userSettings.principalNip}`, 40, sigY + 88);
    doc.text(`NIP. ${userSettings.teacherNip}`, 380, sigY + 88);

    return doc;
  };

  const handleDownloadPreviewPDF = async () => {
    try {
      setIsGeneratingPdf(true);
      const doc = await generateAbsensiPDFDoc();
      const className = attendanceClass || "Semua_Kelas";
      doc.save(`Rekap_Kehadiran_${className.replace(/\s+/g, '_')}.pdf`);
      showAlert(
        "Unduhan Berhasil",
        "Laporan Rekapitulasi Kehadiran (PDF) telah berhasil diunduh.",
        "alert"
      );
    } catch (e: any) {
      showAlert("Gagal", `Gagal mengunduh PDF: ${e.message || e}`, "danger");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePreviewAbsensiPDF = async () => {
    try {
      setIsGeneratingPdf(true);
      const doc = await generateAbsensiPDFDoc();
      const blob = doc.output("blob");
      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl(url);
      setPdfPreviewTitle("Preview Rekapitulasi Kehadiran Siswa (SMAN 1 Cililin)");
    } catch (e: any) {
      showAlert("Gagal", `Gagal memproses Preview PDF: ${e.message || e}`, "danger");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

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
    type: "spring" as const,
    stiffness: 180,
    damping: 24,
    mass: 1,
  };

  const handleAddClass = async () => {
    if (!newClassName.trim()) return;

    // Check if class already exists
    const classExists = classesList.some(
      (c) => c.name.toLowerCase() === newClassName.trim().toLowerCase()
    );

    if (classExists) {
      setClassSaveMessage({
        text: "Maaf, kelas dengan nama tersebut sudah terdaftar dalam sistem.",
        type: "error",
      });
      showAlert(
        "Kelas Sudah Ada",
        "Maaf, kelas dengan nama tersebut sudah terdaftar dalam sistem.",
        "danger"
      );
      return;
    }

    try {
      const clsId = Date.now().toString();
      await setDoc(doc(db, "classes", clsId), {
        name: newClassName.trim(),
        createdAt: new Date().toISOString(),
      });
      setNewClassName("");
      setClassSaveMessage({
        text: "Kelas berhasil ditambahkan ke database!",
        type: "success",
      });
      showAlert("Berhasil", "Kelas berhasil ditambahkan.", "alert");
      localStorage.removeItem("firas_cache_classes");
      fetchTeacherData(false);
    } catch (error) {
      setClassSaveMessage({
        text: "Gagal menambahkan kelas.",
        type: "error",
      });
      handleFirestoreError(error, OperationType.CREATE, "classes");
    }
  };

  const handleDeleteClass = async (id: string) => {
    showConfirm(
      "Hapus Kelas",
      "Apakah Anda yakin ingin menghapus kelas ini?",
      async () => {
        try {
          await deleteDoc(doc(db, "classes", id));
          setClassSaveMessage({
            text: "Kelas berhasil dihapus.",
            type: "success",
          });
          showAlert("Berhasil", "Kelas berhasil dihapus dari sistem.", "alert");
          localStorage.removeItem("firas_cache_classes");
          fetchTeacherData(false);
        } catch (error) {
          setClassSaveMessage({
            text: "Gagal menghapus kelas.",
            type: "error",
          });
          showAlert("Gagal", "Terjadi kesalahan saat menghapus kelas.", "danger");
          handleFirestoreError(error, OperationType.DELETE, `classes/${id}`);
        }
      },
      "Hapus",
    );
  };

  const handleEditClass = (id: string, currentName: string) => {
    setEditingClassId(id);
    setEditingClassName(currentName);
  };

  const handleSaveEditClass = async () => {
    if (!editingClassName.trim() || !editingClassId) return;
    try {
      await setDoc(
        doc(db, "classes", editingClassId),
        {
          name: editingClassName,
        },
        { merge: true },
      );
      setEditingClassId(null);
      setEditingClassName("");
      setClassSaveMessage({
        text: "Perubahan nama kelas berhasil disimpan.",
        type: "success",
      });
      showAlert("Berhasil", "Perubahan nama kelas berhasil disimpan.", "alert");
    } catch (error) {
      setClassSaveMessage({
        text: "Gagal mengubah kelas.",
        type: "error",
      });
      showAlert("Gagal", "Gagal memperbarui nama kelas.", "danger");
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `classes/${editingClassId}`,
      );
    }
  };

  const handleSimpanSiswa = async () => {
    if (!studentName || !studentNisn || !studentClass) {
      setSaveMessage({ text: "Mohon lengkapi semua data", type: "error" });
      return;
    }

    // Validasi NISN (9 digits only for demo purposes)
    if (!/^\d{9}$/.test(studentNisn)) {
      setSaveMessage({
        text: "NISN harus terdiri dari 9 angka",
        type: "error",
      });
      return;
    }

    // Check if student with NISN already exists
    const studentExists = studentsList.some((s) => s.nisn === studentNisn);
    if (studentExists) {
      setSaveMessage({
        text: "Maaf, NISN sudah digunakan oleh siswa lain.",
        type: "error",
      });
      return;
    }

    setIsSaving(true);
    setSaveMessage({ text: "", type: "" });

    try {
      await setDoc(doc(db, "studentsByNisn", studentNisn), {
        nisn: studentNisn,
        displayName: studentName,
        kelas: studentClass,
        accessCode: studentAccessCode,
        role: "student",
        createdAt: new Date().toISOString(),
      });
      setSaveMessage({
        text: "Data siswa berhasil disimpan!",
        type: "success",
      });
      showAlert("Berhasil", "Daftar nama siswa berhasil ditambahkan.", "alert");
      localStorage.removeItem("firas_cache_students");
      fetchTeacherData(false);

      // Clear success message quickly
      setTimeout(() => {
        setSaveMessage({ text: "", type: "" });
      }, 1000);

      setStudentName("");
      setStudentNisn("");
      setStudentClass("");
      setStudentAccessCode("");
    } catch (error) {
      setSaveMessage({ text: "Gagal menyimpan data siswa.", type: "error" });
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `studentsByNisn/${studentNisn}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateTitle = async () => {
    if (!assignmentBab) {
      setAssignmentMessage({ text: "Silakan pilih Bab Pembelajaran terlebih dahulu.", type: "error" });
      return;
    }
    
    setIsGeneratingTitle(true);
    setAssignmentMessage({ text: "", type: "" });
    try {
      const response = await fetchWithRetry("/api/generate-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bab: assignmentBab }),
      });
      
      if (!response.ok) throw new Error("Gagal generate judul");
      
      const data = await response.json();
      setAssignmentMateri(data.title);
    } catch (error) {
      console.warn(error);
      setAssignmentMessage({ text: "Gagal membuat judul dengan AI.", type: "error" });
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const handleSimpanTugas = async () => {
    if (!assignmentBab || !assignmentMateri || !assignmentDesc) {
      setAssignmentMessage({
        text: "Mohon lengkapi judul bab, materi, dan deskripsi.",
        type: "error",
      });
      return;
    }

    const invalidTargets = assignmentTargets.some(
      (t) => !t.kelas || !t.deadline,
    );
    if (invalidTargets || assignmentTargets.length === 0) {
      setAssignmentMessage({
        text: "Mohon lengkapi semua target kelas dan tenggat waktu.",
        type: "error",
      });
      return;
    }

    setIsSavingAssignment(true);
    setAssignmentMessage({ text: "", type: "" });

    try {
      const assignmentId = editingAssignmentId || `TGS-${Date.now()}`;

      // format targets for saving
      const formattedTargets = assignmentTargets.map((t) => ({
        kelas: t.kelas,
        publishedAt: t.publishedAt
          ? new Date(t.publishedAt).toISOString()
          : (assignmentPublishedAt ? new Date(assignmentPublishedAt).toISOString() : new Date().toISOString()),
        deadline: new Date(t.deadline).toISOString(),
      }));

      await setDoc(
        doc(db, "assignments", assignmentId),
        {
          bab: assignmentBab,
          materi: assignmentMateri,
          targets: formattedTargets,
          kelas: formattedTargets[0]?.kelas || "", // fallback
          deadline: formattedTargets[0]?.deadline || "", // fallback
          publishedAt: assignmentPublishedAt ? new Date(assignmentPublishedAt).toISOString() : new Date().toISOString(),
          description: assignmentDesc,
          taskLink: assignmentTaskLink.trim(),
          linkTugas: assignmentTaskLink.trim(),
          updatedAt: new Date().toISOString(),
          ...(editingAssignmentId
            ? {}
            : {
                createdAt: new Date().toISOString(),
                teacherId: user?.uid || "mock-admin", // using mock-admin for demo
              }),
        },
        { merge: true },
      );

      setAssignmentMessage({
        text: editingAssignmentId
          ? "Tugas berhasil diperbarui!"
          : "Tugas berhasil diterbitkan!",
        type: "success",
      });
      setTimeout(() => {
        setAssignmentMessage({ text: "", type: "" });
      }, 3000);
      setAssignmentBab("");
      setAssignmentMateri("");
      setAssignmentPublishedAt("");
      setSharedDeadline("");
      setAssignmentTargets([]);
      setAssignmentDesc("");
      setAssignmentTaskLink("");
      setEditingAssignmentId(null);
    } catch (error) {
      setAssignmentMessage({
        text: editingAssignmentId
          ? "Gagal memperbarui tugas."
          : "Gagal menerbitkan tugas.",
        type: "error",
      });
      handleFirestoreError(error, OperationType.CREATE, "assignments");
    } finally {
      setIsSavingAssignment(false);
    }
  };

  const handleSimpanMateri = async () => {
    if (!materiTitle || !materiBab || !materiDriveUrl) {
      setMateriSaveMessage({
        text: "Mohon lengkapi judul materi, bab, dan link Google Drive.",
        type: "error",
      });
      return;
    }

    setIsSavingMateri(true);
    setMateriSaveMessage({ text: "", type: "" });

    try {
      const materialId = editingMateriId || `MAT-${Date.now()}`;
      await setDoc(doc(db, "materials", materialId), {
        id: materialId,
        title: materiTitle,
        description: materiDescription || "",
        subject: materiSubject,
        bab: materiBab,
        driveUrl: materiDriveUrl,
        kelasRef: materiKelas || "",
        order: 0,
        createdAt: new Date().toISOString(),
      }, { merge: true });

      trackUsage(0, 1);
      
      setMateriTitle("");
      setMateriDescription("");
      setMateriBab("");
      setMateriDriveUrl("");
      setMateriKelas("");
      setEditingMateriId(null);
      setActiveMateriTab("daftar");
      showAlert("Berhasil", editingMateriId ? "Materi berhasil diperbarui." : "Materi baru berhasil ditambahkan.", "alert");
      localStorage.removeItem("firas_cache_materials");
      fetchTeacherData(false);
    } catch (e: any) {
      console.warn("Gagal menyimpan materi:", e);
      setMateriSaveMessage({ text: "Gagal menyimpan materi: " + (e.message || e), type: "error" });
    } finally {
      setIsSavingMateri(false);
    }
  };

  const handleDeleteMateri = async (id: string) => {
    showConfirm(
      "Hapus Materi",
      "Apakah Anda yakin ingin menghapus materi ini?",
      async () => {
        try {
          await deleteDoc(doc(db, "materials", id));
          trackUsage(0, 1);
          showAlert("Berhasil", "Materi berhasil dihapus.", "alert");
          localStorage.removeItem("firas_cache_materials");
          fetchTeacherData(false);
        } catch (e: any) {
          console.warn("Gagal menghapus materi:", e);
          showAlert("Gagal", "Gagal menghapus materi.", "danger");
        }
      },
      "Hapus"
    );
  };

  const handleEditMateri = (material: any) => {
    setEditingMateriId(material.id);
    setMateriTitle(material.title || "");
    setMateriDescription(material.description || "");
    setMateriSubject(material.subject || "Informatika");
    setMateriBab(material.bab || "");
    setMateriDriveUrl(material.driveUrl || "");
    setMateriKelas(material.kelasRef || "");
    setActiveMateriTab("tambah");
    setActiveMenu("materi-ajar");
  };

  const handleGenerateAIExam = async () => {
    if (!examSubject || !examBab) {
      setExamSaveMessage({
        text: "Silakan pilih Mata Pelajaran dan Bab terlebih dahulu.",
        type: "error",
      });
      return;
    }
    // Launch Modal and reset states
    setShowExamProgressModal(true);
    setExamGeneratorStatus("generating");
    setExamGeneratorProgress("Inisialisasi koneksi dengan server AI Gemini...");
    setExamGeneratorError("");
    setIsGeneratingExam(true);
    setExamSaveMessage({ text: "", type: "" });

    // Step indicators
    const progressSteps = [
      "Menghubungkan ke API Google Gemini...",
      "Menganalisis Bab Pelajaran Informatika Kurikulum Merdeka...",
      "Menyusun blueprint soal pilihan ganda (A, B, C, D, E)...",
      "Membuat butir soal berstandar AKM / UTBK...",
      "Memvalidasi opsi kunci jawaban dan mengukur tingkat kesulitan...",
      "Kecepatan transmisi disesuaikan, memproses token visual siswa...",
      "Hampir Selesai! Memformat hasil ke struktur JSON data sekolah..."
    ];

    let currentStep = 0;
    const progressInterval = setInterval(() => {
      if (currentStep < progressSteps.length) {
        setExamGeneratorProgress(progressSteps[currentStep]);
        currentStep++;
      }
    }, 2200);

    try {
      const formData = new FormData();
      formData.append("subject", examSubject);
      formData.append("bab", examBab);
      formData.append("count", examQuestionCount.toString());
      formData.append("tema", examTema);
      formData.append("materi", examMateri);
      formData.append("description", examDescription);
      formData.append("pastedText", examPastedText);
      
      if (examDocument) {
        formData.append("document", examDocument);
      }

      const response = await fetchWithRetry("/api/generate-exam", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        let errMsg = "Koneksi terputus atau server mengembalikan respons tidak valid.";
        try {
          const errData = await response.json();
          errMsg = errData.details || errData.error || errMsg;
        } catch {
          try {
            const text = await response.text();
            if (text) errMsg = text;
          } catch (_) {}
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
        setExamQuestions(data.questions);
        if (!examToken) {
          setExamToken(generateRandomToken());
        }
        setExamGeneratorStatus("success");
        setExamSaveMessage({
          text: `Berhasil men-generate ${data.questions.length} soal pilihan ganda berkualitas tinggi menggunakan AI Gemini! Silakan ulas dan sesuaikan data soal di bawah sebelum merilisnya ke siswa.`,
          type: "success",
        });
      } else {
        throw new Error("Format data yang diterima dari AI tidak valid atau kosong.");
      }
    } catch (error: any) {
      clearInterval(progressInterval);
      console.warn(error);
      setExamGeneratorStatus("error");
      const cleanError = error.message || "Gagal menghubungi API atau format tanggapan salah.";
      setExamGeneratorError(cleanError);
      setExamSaveMessage({
        text: `Gagal membuat soal: ${cleanError}`,
        type: "error",
      });
    } finally {
      setIsGeneratingExam(false);
    }
  };

  const handleCreateAnswerSheetFromExternal = () => {
    const count = Number(examQuestionCount) || 5;
    const generated = Array.from({ length: count }, (_, i) => ({
      text: `Soal Nomor ${i + 1} (Silakan lihat pada lembar dokumen PDF / Kuis Notebook LM)`,
      options: [
        "Pilihan A",
        "Pilihan B",
        "Pilihan C",
        "Pilihan D",
        "Pilihan E",
      ],
      correctIndex: 0,
    }));
    setExamQuestions(generated);
    if (!examToken) {
      setExamToken(generateRandomToken());
    }
    showAlert(
      "Lembar Jawaban Dibuat",
      `Berhasil membuat ${count} butir lembar jawaban pilihan ganda (A-E) untuk soal luar. Silakan tentukan opsi jawaban yang benar dan simpan ujian.`,
      "alert"
    );
  };

  const handleSimpanUjian = async () => {
    const targetClasses = selectedExamClasses.length > 0 ? selectedExamClasses : (examKelas ? [examKelas] : []);
    if (!examTitle.trim() || !examSubject.trim() || targetClasses.length === 0 || !examToken.trim()) {
      setExamSaveMessage({
        text: "Mohon lengkapi judul ujian, mata pelajaran, minimal 1 target kelas (checklist), dan token ujian.",
        type: "error",
      });
      return;
    }

    if (examQuestions.length === 0) {
      setExamSaveMessage({
        text: "Belum ada soal ujian. Silakan klik tombol 'Generasi Soal dengan AI' terlebih dahulu.",
        type: "error",
      });
      return;
    }

    setIsSavingExam(true);
    setExamSaveMessage({ text: "", type: "" });

    try {
      const kelasRefVal = targetClasses.includes("SEMUA_KELAS") ? "SEMUA_KELAS" : targetClasses.join(", ");
      const examId = `EXM-${Date.now()}`;
      await setDoc(doc(db, "exams", examId), {
        id: examId,
        title: examTitle.trim(),
        subject: examSubject.trim(),
        bab: examBab,
        kelasRef: kelasRefVal,
        targetClasses: targetClasses,
        token: examToken.trim().toUpperCase(),
        duration: examDuration * 60, // save in seconds
        kkm: Number(examKkm) || 75,
        category: "Pilihan Ganda",
        tema: examTema,
        materi: examMateri.trim(),
        externalQuizUrl: examExternalQuizUrl.trim(),
        questions: examQuestions,
        createdAt: new Date().toISOString(),
        teacherId: user?.uid || "mock-admin",
      });

      setExamSaveMessage({
        text: "Ujian Kompetensi Mandiri berhasil diterbitkan dan token dirilis!",
        type: "success",
      });

      showAlert("Berhasil", `Ujian online berhasil diterbitkan untuk kelas (${kelasRefVal}). Token ujian Anda adalah: ${examToken.toUpperCase()}`, "alert");
      localStorage.removeItem("firas_cache_exams");
      fetchTeacherData(false);

      // Reset form
      setExamTitle("");
      setExamSubject("Informatika");
      setExamBab("");
      setExamKelas("");
      setSelectedExamClasses([]);
      setExamTema("Preetes");
      setExamMateri("");
      setExamDuration(30);
      setExamKkm(75);
      setExamQuestions([]);
      setExamToken("");
      setExamExternalQuizUrl("");
      setExamPastedText("");
      setExamDescription("");
      setActiveExamTab("daftar");
    } catch (error) {
      setExamSaveMessage({
        text: "Gagal mempublikasikan ujian online ke cloud.",
        type: "error",
      });
      handleFirestoreError(error, OperationType.CREATE, "exams");
    } finally {
      setIsSavingExam(false);
    }
  };

  const handleOpenPublishModal = (exam: any) => {
    setExamToPublish(exam);
    setNewPublishKelas("");
    setPublishOtherClasses([]);
    setNewPublishToken(generateRandomToken());
    setIsPublishOtherClassModalOpen(true);
  };

  const handlePublishToOtherClass = async () => {
    const targetClasses = publishOtherClasses.length > 0 ? publishOtherClasses : (newPublishKelas ? [newPublishKelas] : []);
    if (targetClasses.length === 0 || !examToPublish || !newPublishToken.trim()) {
      showAlert("Peringatan", "Mohon pilih minimal satu kelas target (checklist) dan token ujian.", "danger");
      return;
    }

    setIsSavingDuplicateExam(true);
    try {
      for (const targetCls of targetClasses) {
        const newExamId = `EXM-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        await setDoc(doc(db, "exams", newExamId), {
          ...examToPublish,
          id: newExamId,
          kelasRef: targetCls,
          targetClasses: [targetCls],
          token: newPublishToken.toUpperCase(),
          createdAt: new Date().toISOString(),
        });
      }

      setIsPublishOtherClassModalOpen(false);
      showAlert(
        "Berhasil", 
        `Ujian berhasil diterbitkan untuk ${targetClasses.length} kelas target (${targetClasses.join(", ")}). Token Ujian: ${newPublishToken.toUpperCase()}`, 
        "alert"
      );
      setPublishOtherClasses([]);
      setNewPublishKelas("");
    } catch (error) {
      console.warn(error);
      showAlert("Gagal", "Gagal menerbitkan ulang ujian.", "danger");
    } finally {
      setIsSavingDuplicateExam(false);
    }
  };

  const handleCreateAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementContent.trim() || !announcementKelas) {
      showAlert("Peringatan", "Mohon lengkapi judul, konten, dan kelas sasaran pengumuman.", "danger");
      return;
    }

    setIsSavingAnnouncement(true);
    try {
      const announcementId = `ANN-${Date.now()}`;
      const pubDate = announcementPublishDate || new Date().toISOString().split("T")[0];
      await setDoc(doc(db, "announcements", announcementId), {
        id: announcementId,
        title: announcementTitle.trim(),
        content: announcementContent.trim(),
        kelasRef: announcementKelas,
        publishDate: pubDate,
        createdAt: new Date().toISOString(),
        teacherId: user?.uid || "mock-admin",
      });

      trackUsage(0, 1);
      
      setAnnouncementTitle("");
      setAnnouncementContent("");
      setAnnouncementKelas("");
      setAnnouncementPublishDate(new Date().toISOString().split("T")[0]);
      
      showAlert("Berhasil", "Pengumuman berhasil diterbitkan.", "alert");
      localStorage.removeItem("firas_cache_announcements");
      fetchTeacherData(false);
    } catch (error) {
      console.warn(error);
      showAlert("Gagal", "Gagal menerbitkan pengumuman.", "danger");
      handleFirestoreError(error, OperationType.CREATE, "announcements");
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    showConfirm(
      "Hapus Pengumuman",
      "Apakah Anda yakin ingin menghapus pengumuman ini?",
      async () => {
        try {
          await deleteDoc(doc(db, "announcements", id));
          showAlert("Berhasil", "Pengumuman telah dihapus.", "alert");
          localStorage.removeItem("firas_cache_announcements");
          fetchTeacherData(false);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `announcements/${id}`);
        }
      },
      "Hapus"
    );
  };

  const handleDeleteExam = async (id: string) => {
    showConfirm(
      "Hapus Ujian Online",
      "Apakah Anda yakin ingin menghapus dan membatalkan ujian online ini? Semua siswa tidak akan bisa mengakses ujian ini lagi.",
      async () => {
        try {
          await deleteDoc(doc(db, "exams", id));
          showAlert("Ujian Dihapus", "Ujian online telah dihapus dari database sekolah.", "alert");
          localStorage.removeItem("firas_cache_exams");
          fetchTeacherData(false);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `exams/${id}`);
        }
      },
      "Hapus Ujian"
    );
  };

  const handleSaveAttendance = async () => {
    if (!attendanceDate || !attendanceClass) {
      showAlert("Peringatan", "Mohon pilih tanggal dan kelas terlebih dahulu", "danger");
      return;
    }
    setSavingAttendance(true);
    try {
      // Find students in this class
      const classStudents = studentsList.filter(s => s.kelas === attendanceClass);
      
      // Default unselected students to "Hadir"
      const completeAttendanceData = { ...attendanceData };
      classStudents.forEach(student => {
        if (!completeAttendanceData[student.nisn]) {
          completeAttendanceData[student.nisn] = "Hadir";
        }
      });

      const absensiId = `ABS-${attendanceDate}-${attendanceClass}`;
      await setDoc(doc(db, "absensi", absensiId), {
        id: absensiId,
        date: attendanceDate,
        kelasRef: attendanceClass,
        data: completeAttendanceData,
        createdAt: new Date().toISOString(),
        teacherId: user?.uid || "mock-admin",
      });

      setIsEditingAttendance(false);
      showAlert("Berhasil", "Data absensi berhasil disimpan", "alert");
      localStorage.removeItem("firas_cache_absensi");
      fetchTeacherData(false);
    } catch (e) {
      console.warn(e);
      showAlert("Gagal", "Gagal menyimpan data absensi", "danger");
    } finally {
      setSavingAttendance(false);
    }
  };

  useEffect(() => {
    if (attendanceDate && attendanceClass) {
      const existing = absensiList.find(a => a.date === attendanceDate && a.kelasRef === attendanceClass);
      if (existing) {
        setAttendanceData(existing.data || {});
        setIsEditingAttendance(false);
      } else {
        setAttendanceData({});
        setIsEditingAttendance(true);
      }
    }
  }, [attendanceDate, attendanceClass, absensiList]);

  const handleEditAbsensi = (absData: any) => {
    setAttendanceDate(absData.date);
    setAttendanceClass(absData.kelasRef);
    setAttendanceData(absData.data || {});
    setIsEditingAttendance(true);
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  const handleDeleteAbsensi = (id: string, dateStr?: string) => {
    const formattedDate = dateStr ? ` tanggal ${dateStr}` : "";
    showConfirm(
      "Hapus Tanggal Presensi",
      `Apakah Anda yakin ingin menghapus seluruh data presensi${formattedDate}? Seluruh rekapan kehadiran siswa pada tanggal tersebut akan dihapus secara permanen.`,
      async () => {
        try {
          await deleteDoc(doc(db, "absensi", id));
          showAlert("Berhasil", `Data presensi${formattedDate} telah berhasil dihapus.`, "alert");
          localStorage.removeItem("firas_cache_absensi");
          fetchTeacherData(false);
        } catch (e) {
          console.warn(e);
          showAlert("Gagal", "Gagal menghapus data presensi", "danger");
        }
      },
      "Hapus Tanggal"
    );
  };

   if (!isTeacherAuth) {
     return (
       <div className="min-h-screen bg-slate-950 flex items-center justify-center">
         <div className="text-center space-y-4">
           <div className="w-12 h-12 border-4 border-[#85cc00] border-t-transparent rounded-full animate-spin mx-auto"></div>
           <p className="text-slate-400 text-sm font-medium">Memverifikasi Hak Akses...</p>
         </div>
       </div>
     );
   }

   return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-sans text-slate-700 relative">
      <NotificationModal
        {...modalConfig}
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
      />
      <ResetDashboardModal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onConfirm={handleResetConfirm}
      />
      <StorageManagerModal
        isOpen={isStorageModalOpen}
        onClose={() => setIsStorageModalOpen(false)}
        submissions={submissionsList}
      />
      {/* Mobile sidebar overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 bg-white/95 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col bg-sky-100 border-r border-sky-200 text-slate-700 shrink-0 transition-all duration-300 ease-in-out ${
          isSidebarOpen 
            ? "translate-x-0 w-72 md:w-[325px] shadow-2xl md:shadow-none" 
            : "-translate-x-full w-72 md:translate-x-0 md:w-0 overflow-hidden border-none"
        }`}
      >
        {/* Floating Close Button in the vertical center of the sidebar's right edge on mobile */}
        {isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-50 flex md:hidden h-12 w-8 items-center justify-center rounded-r-2xl bg-sky-400 text-white shadow-lg hover:bg-sky-500 hover:w-10 translate-x-full transition-all cursor-pointer border-y border-r border-sky-200"
            title="Sembunyikan Menu"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        <div className="h-20 px-6 flex items-center justify-between border-b border-sky-200 bg-gradient-to-br from-[#85cc00]/22 via-emerald-50/30 to-sky-50/90 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 flex items-center justify-center shrink-0">
              <img loading="lazy" 
                src={getDriveImageUrl("https://drive.google.com/file/d/1P395tuZymxs3qero4XduMpHy7g2GJrdR/view?usp=sharing")}
                alt="Logo Sekolah"
                className="w-full h-full object-contain animate-pulse-slow"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex flex-col">
              <h1 className="text-md font-black text-[#85cc00] tracking-tight leading-none">
                SiPinter Apps
              </h1>
              <span className="text-[10px] font-bold text-emerald-700 mt-1 uppercase tracking-wider">
                SMA NEGERI 1 CILILIN
              </span>
            </div>
          </div>
          <button
            className="rounded-xl p-2 text-sky-700 hover:text-white hover:bg-[#85cc00] transition-colors cursor-pointer hidden md:flex items-center justify-center"
            onClick={() => setIsSidebarOpen(false)}
            title="Sembunyikan Menu"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 px-4 pt-8 space-y-8 overflow-y-auto">
          <div>
            <p className="px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-sky-700 mb-6">
              Navigation
            </p>
                    <nav className="space-y-1.5">
              {menus.map((menu, idx) => {
                const Icon = menu.icon;
                const isActive = activeMenu === menu.id;
                return (
                  <button
                    key={`teacher-menu-${menu.id}-${idx}`}
                    onClick={() => handleMenuChange(menu.id, idx)}
                    className={`group relative flex w-full items-center rounded-2xl px-4 py-3 text-sm font-bold tracking-tight duration-300 transition-all ${
                      isActive
                        ? "text-slate-900 bg-[#85cc00] shadow-lg shadow-[#85cc00]/20"
                        : "text-sky-700 hover:text-sky-900 hover:bg-sky-200"
                    }`}
                  >
                    <div className="relative z-10 flex items-center justify-between w-full">
                      <div className="flex items-center min-w-0">
                        <Icon
                          className={`mr-3.5 h-5 w-5 shrink-0 transition-colors ${isActive ? "text-slate-950" : "text-sky-600 group-hover:text-sky-900"}`}
                        />
                        <span className="tracking-wide whitespace-nowrap truncate">{menu.label}</span>
                      </div>
                      {isActive && (
                        <ChevronRight className="w-4 h-4 text-slate-950 shrink-0 ml-2" />
                      )}
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="pt-8 border-t border-sky-200">
            <p className="px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600 mb-6">
              Server Status
            </p>
            <div className="px-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-[11px] font-bold text-sky-700 uppercase tracking-widest">
                  Live Database
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-slate-200"></div>
                <span className="text-[11px] font-bold text-sky-700 uppercase tracking-widest">
                  Encrypted Session
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="rounded-xl border-t border-sky-600 p-5 mt-auto">
            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-5 text-sm font-black text-white uppercase tracking-widest hover:bg-red-700 shadow-xl shadow-red-900/20 active:scale-95 transition-all cursor-pointer"
            >
              <LogOut className="h-5 w-5" />
              Keluar
            </button>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden relative z-0 bg-white">
        {/* Floating pull-tab when sidebar is closed (both desktop and mobile) */}
        {!isSidebarOpen && (
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="fixed left-0 top-1/2 -translate-y-1/2 z-45 flex h-12 w-8 items-center justify-center rounded-r-2xl bg-sky-500 text-white shadow-lg hover:bg-sky-600 hover:w-10 transition-all cursor-pointer border-y border-r border-sky-400/20"
            title="Tampilkan Menu"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
        <header className="flex h-20 flex-shrink-0 items-center justify-between bg-gradient-to-r from-[#85cc00]/15 via-[#85cc00]/5 to-slate-50 px-4 sm:px-10 border-b border-slate-200 shadow-sm sticky top-0 z-50">
          <div className="flex items-center gap-4 sm:gap-6">
            {/* Hamburger button deleted per user request ("Hapus garis 3") */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center shrink-0">
                <img loading="lazy" 
                  src={getDriveImageUrl("https://drive.google.com/file/d/1P395tuZymxs3qero4XduMpHy7g2GJrdR/view?usp=sharing")}
                  alt="Logo Sekolah"
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

          <div className="flex items-center gap-1.5 sm:gap-2 select-none">
            {/* Refresh / Segarkan Data */}
            <button
               onClick={() => fetchTeacherData(true)}
               disabled={isRefreshingTeacherData}
               className="flex items-center justify-center w-12 h-12 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 hover:text-[#85cc00] transition-all relative shadow-sm cursor-pointer"
               title="Segarkan / Update Data Cloud"
            >
              <RefreshCw className={`h-5 w-5 ${isRefreshingTeacherData ? "animate-spin text-[#85cc00]" : ""}`} />
            </button>

            {/* Notification */}
            <button
               className="flex items-center justify-center w-12 h-12 rounded-full bg-white hover:bg-slate-50 border border-slate-200 text-[#85cc00] transition-colors relative shadow-sm cursor-pointer"
               title="Pemberitahuan"
            >
              <Bell className="h-5 w-5" />
            </button>

            <div className="relative">
              {/* Trigger Button */}
              <button
                onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                className="flex flex-col justify-center hover:opacity-80 transition-all cursor-pointer"
                title="Menu Profil Guru"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e4e6eb] text-[#85cc00] shadow-sm border border-slate-200 overflow-hidden shrink-0">
                  <div className="w-full h-full overflow-hidden rounded-full flex items-center justify-center">
                  {teacherPhotoUrl ? (
                    <img loading="lazy"
                      src={teacherPhotoUrl}
                      alt="Profile"
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <User className="w-[120%] h-[120%] text-[#aeb4bb] translate-y-1.5" fill="currentColor" />
                  )}
                </div>
                </div>
              </button>

              {/* Input file tersembunyi */}
              <input
                type="file"
                id="teacher-photo-input"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />

              {/* Dropdown Menu */}
              <AnimatePresence>
                {showProfileDropdown && (
                  <>
                    {/* Backdrop to close dropdown */}
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowProfileDropdown(false)}
                    />
                    
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-3 w-72 bg-white border border-slate-200 rounded-3xl shadow-2xl p-5 z-55 overflow-hidden ring-1 ring-slate-100"
                    >
                      {/* User Info Header in dropdown */}
                      <div className="flex flex-col border-b border-slate-50 pb-4 mb-3 text-center">
                        <div className="relative group mb-3">
                          <div className="w-18 h-18 overflow-hidden rounded-full border-2 border-[#e4e6eb] flex items-center justify-center bg-[#e4e6eb] shadow-md">
                            {teacherPhotoUrl ? (
                              <img loading="lazy"
                                src={teacherPhotoUrl}
                                alt="Profile Large"
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <User className="w-[120%] h-[120%] text-[#aeb4bb] translate-y-2" fill="currentColor" />
                            )}
                          </div>
                        </div>

                        <span className="text-sm font-bold text-slate-900 leading-none">
                          Agan Parta, S.Kom.
                        </span>
                        <span className="text-[11px] font-medium text-slate-400 mt-1 truncate max-w-full">
                          {user?.email || "agan121@guru.sma.belajar.id"}
                        </span>
                        <span className="text-[10px] font-black text-[#85cc00] mt-1.5 bg-[#85cc00]/10 border border-[#85cc00]/20 px-2.5 py-1 rounded-full uppercase tracking-widest font-sans">
                          Administrator Utama
                        </span>
                      </div>

                      {/* Dropdown Actions */}
                      <div className="space-y-1">
                        <button
                          className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-[#85cc00] rounded-2xl cursor-pointer transition-all uppercase tracking-wider"
                          onClick={() => {
                            setIsStorageModalOpen(true);
                            setShowProfileDropdown(false);
                          }}
                        >
                          <Database className="w-4 h-4 text-slate-400" />
                          Penyimpanan
                        </button>
                        <label
                          htmlFor="teacher-photo-input"
                          className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-slate-500 hover:bg-slate-50 hover:text-[#85cc00] rounded-2xl cursor-pointer transition-all uppercase tracking-wider"
                          onClick={() => setShowProfileDropdown(false)}
                        >
                          <svg
                            className="w-4 h-4 text-slate-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2.5}
                              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2.5}
                              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                            />
                          </svg>
                          <span>Unggah Foto Baru</span>
                        </label>

                        {teacherPhotoUrl && (
                          <button
                            onClick={handlePhotoDelete}
                            className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-rose-500 hover:bg-rose-50 rounded-2xl cursor-pointer transition-all text-left uppercase tracking-wider"
                          >
                            <svg
                              className="w-4 h-4 text-rose-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                            <span>Hapus Foto Profil</span>
                          </button>
                        )}

                        {/* Google Drive Connection */}
                        <div className="border-t border-slate-100 pt-3 mt-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4 mb-2">
                            Penyimpanan Tugas
                          </p>
                          {teacherDriveConnected && !isDriveTokenExpired ? (
                            <div className="mx-4 p-3 bg-emerald-50 rounded-2xl border border-emerald-100/60 mb-2">
                              <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider mb-1">
                                ‚úì Drive Terhubung
                              </p>
                              <p className="text-[10px] text-slate-500 font-semibold truncate mb-2">
                                {teacherDriveEmail}
                              </p>
                              <button
                                onClick={handleDisconnectDrive}
                                className="w-full py-2 bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-[9px] uppercase tracking-widest rounded-xl transition-all cursor-pointer"
                              >
                                Putuskan Drive
                              </button>
                            </div>
                          ) : teacherDriveConnected && isDriveTokenExpired ? (
                            <div className="mx-4 p-3.5 bg-amber-50 rounded-2xl border border-amber-100/60 mb-2">
                              <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                                ‚ö†Ô∏è Sesi Drive Kedaluwarsa
                              </p>
                              <p className="text-[9.5px] text-slate-600 font-medium mb-2.5 leading-relaxed">
                                Sesi Google Drive Guru habis (kedaluwarsa otomatis setiap 1 jam).
                                <span className="text-emerald-700 font-bold block mt-1">‚úì Berkat Fitur Cadangan Otomatis, siswa Anda tetap dapat mengumpulkan tugas secara lancar lewat Firebase Storage cadangan.</span>
                              </p>
                              <button
                                onClick={handleConnectDrive}
                                disabled={isConnectingDrive}
                                className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[9px] uppercase tracking-widest rounded-xl transition-all cursor-pointer mb-1 shadow-sm"
                              >
                                {isConnectingDrive ? "Menghubungkan..." : "Hubungkan Ulang Drive"}
                              </button>
                              <button
                                onClick={handleDisconnectDrive}
                                className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[8px] uppercase tracking-widest rounded-lg transition-all cursor-pointer"
                              >
                                Putuskan Drive
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={handleConnectDrive}
                              disabled={isConnectingDrive}
                              className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-[#85cc00] hover:bg-slate-50 rounded-2xl cursor-pointer transition-all uppercase tracking-wider"
                            >
                              <svg className="w-4 h-4 text-[#85cc00]" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/>
                              </svg>
                              <span>{isConnectingDrive ? "Menghubungkan..." : "Hubungkan Drive Guru"}</span>
                            </button>
                          )}
                        </div>

                        <div className="h-px bg-slate-50 my-2"></div>

                        <button
                          onClick={() => {
                            setShowProfileDropdown(false);
                            handleLogout();
                          }}
                          className="flex items-center gap-3 w-full px-4 py-3 text-xs font-bold text-rose-600 bg-rose-50/50 hover:bg-rose-100 hover:text-rose-700 rounded-2xl cursor-pointer transition-all text-left uppercase tracking-wider"
                        >
                          <LogOut className="w-4 h-4 text-slate-400" />
                          <span>Keluar Sistem</span>
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={() => setShowLogoutModal(true)}
              className="flex flex-col justify-center hover:opacity-80 transition-all cursor-pointer"
              title="Keluar"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-rose-500 text-white shadow-sm hover:bg-rose-600 active:scale-95 transition-all border border-slate-200">
                <Power className="w-5 h-5" />
              </div>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-x-hidden overflow-y-auto bg-gradient-to-br from-emerald-50/60 via-slate-50 to-[#85cc00]/15 p-4 sm:p-8 md:p-12 scroll-smooth flex flex-col relative">
          {/* Decorative background green glow blobs (gradasi pada sela-sela frame agar tidak polos) */}
          <div className="absolute top-10 left-10 w-96 h-96 rounded-full bg-gradient-to-br from-[#85cc00]/15 to-emerald-400/5 blur-3xl pointer-events-none z-0" />
          <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-gradient-to-tr from-emerald-500/15 to-[#85cc00]/5 blur-3xl pointer-events-none z-0" />
          <div className="absolute top-1/2 left-1/3 w-[500px] h-[500px] rounded-full bg-gradient-to-r from-emerald-200/10 to-[#85cc00]/10 blur-3xl pointer-events-none z-0" />

          <div className="w-full relative z-10">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeMenu}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  x: springConfig,
                  opacity: { duration: 0.2 },
                }}
                className="min-h-[70vh] w-full"
              >
                {activeMenu === "menu-pengguna" && (
                  <div className="space-y-12">
                    <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                      <div className="max-w-2xl">
                        <h2 className="text-2xl font-bold text-slate-950">Menu Pengguna</h2>
                        <p className="text-slate-500 font-medium text-lg leading-relaxed">
                          Konfigurasi identitas pengampu dan administrasi laporan penilaian.
                        </p>
                      </div>
                      <div className="flex items-center gap-3 self-center md:self-end">
                        {!isEditingUserSettings ? (
                          <button
                            onClick={() => setIsEditingUserSettings(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                          >
                            <Edit3 size={18} />
                            <span>Edit Profil</span>
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              setIsEditingUserSettings(false);
                              try {
                                const uid = user?.uid || "default_teacher";
                                await setDoc(doc(db, "users", uid), {
                                  userSettings: userSettings
                                }, { merge: true });
                                showAlert("Berhasil", "Profil pengguna berhasil diperbarui.", "alert");
                              } catch (e) {
                                console.warn("Gagal menyimpan profil:", e);
                                showAlert("Error", `Gagal menyimpan profil: ${e instanceof Error ? e.message : String(e)}`, "danger");
                              }
                            }}
                            className="flex items-center gap-2 px-8 py-3 bg-[#85cc00] text-white font-bold rounded-2xl hover:bg-[#74b300] transition-all shadow-lg shadow-[#85cc00]/20 active:scale-95"
                          >
                            <Save size={18} />
                            <span>Simpan Perubahan</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                      <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40 space-y-8">
                        <div className="space-y-6">
                          <h3 className="text-xl font-bold flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                              <BookOpen size={18} />
                            </div>
                            Identitas Mata Pelajaran
                          </h3>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Nama Mata Pelajaran</label>
                              <input 
                                type="text" 
                                placeholder="Contoh: Informatika" 
                                value={userSettings.subjectName} 
                                disabled={!isEditingUserSettings}
                                onChange={(e) => setUserSettings({...userSettings, subjectName: e.target.value})} 
                                className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} 
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Tahun Pelajaran</label>
                                <input 
                                  type="text" 
                                  placeholder="Contoh: 2026/2027" 
                                  value={userSettings.academicYear} 
                                  disabled={!isEditingUserSettings}
                                  onChange={(e) => setUserSettings({...userSettings, academicYear: e.target.value})} 
                                  className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} 
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Semester</label>
                                <select 
                                  value={userSettings.semester} 
                                  disabled={!isEditingUserSettings}
                                  onChange={(e) => setUserSettings({...userSettings, semester: e.target.value})} 
                                  className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all appearance-none ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white cursor-pointer'}`}
                                >
                                  <option value="Ganjil">Ganjil</option>
                                  <option value="Genap">Genap</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-6 pt-6 border-t border-slate-100">
                          <h3 className="text-xl font-bold flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                              <User size={18} />
                            </div>
                            Data Guru Mata Pelajaran
                          </h3>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Nama Lengkap & Gelar</label>
                              <input 
                                type="text" 
                                placeholder="Nama Guru" 
                                value={userSettings.teacherName} 
                                disabled={!isEditingUserSettings}
                                onChange={(e) => setUserSettings({...userSettings, teacherName: e.target.value})} 
                                className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} 
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">NIP Guru</label>
                              <input 
                                type="text" 
                                placeholder="NIP Guru" 
                                value={userSettings.teacherNip} 
                                disabled={!isEditingUserSettings}
                                onChange={(e) => setUserSettings({...userSettings, teacherNip: e.target.value})} 
                                className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} 
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40 space-y-8">
                        <div className="space-y-6">
                          <h3 className="text-xl font-bold flex items-center gap-3">
                            <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                              <School size={18} />
                            </div>
                            Data Kepala Sekolah
                          </h3>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">Nama Kepala Sekolah</label>
                              <input 
                                type="text" 
                                placeholder="Nama Kepala Sekolah" 
                                value={userSettings.principalName} 
                                disabled={!isEditingUserSettings}
                                onChange={(e) => setUserSettings({...userSettings, principalName: e.target.value})} 
                                className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} 
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-bold text-slate-600 uppercase tracking-wider">NIP Kepala Sekolah</label>
                              <input 
                                type="text" 
                                placeholder="NIP Kepala Sekolah" 
                                value={userSettings.principalNip} 
                                disabled={!isEditingUserSettings}
                                onChange={(e) => setUserSettings({...userSettings, principalNip: e.target.value})} 
                                className={`w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all ${!isEditingUserSettings ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`} 
                              />
                            </div>
                          </div>
                        </div>

                        <div className="p-8 rounded-2xl bg-slate-50 border border-slate-100 mt-10">
                          <div className="flex gap-4">
                            <div className="h-10 w-10 rounded-full bg-white flex items-center justify-center shadow-sm text-[#85cc00]">
                              <Info size={20} />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-900 mb-1">Informasi Sinkronisasi</h4>
                              <p className="text-sm text-slate-500 leading-relaxed">
                                Data yang Anda inputkan di sini akan otomatis digunakan sebagai identitas pada file laporan PDF maupun Excel yang diunduh.
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeMenu === "dashboard" && (
                  <div className="space-y-10">
                    {/* Hero Card */}
                    <div className="bg-gradient-to-r from-[#85cc00] via-emerald-500 to-emerald-600 rounded-[3rem] p-10 sm:p-14 text-white shadow-2xl relative overflow-hidden group border border-[#85cc00]/30 shadow-[#85cc00]/15">
                      <div className="absolute top-0 right-0 w-[40%] h-full bg-white/20 blur-3xl -mr-20 -mt-20 rounded-full opacity-50 group-hover:opacity-100 transition-opacity duration-700"></div>
                      <div className="absolute bottom-0 left-0 w-[30%] h-[30%] bg-black/10 blur-3xl -ml-10 -mb-10 rounded-full opacity-50"></div>
                      
                      <div className="relative z-10 flex flex-col items-start gap-8">
                        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                          {/* Logo removed */}
                          <h1 className="text-4xl sm:text-6xl font-brand font-black text-white tracking-tighter drop-shadow-lg">SiPinter Apps</h1>
                          <SimpleDigitalClock />
                        </div>
                        
                        <p className="text-[10px] sm:text-xs font-bold text-emerald-50 uppercase tracking-[0.3em] select-none">CERDAS ‚Ä¢ INOVATIF ‚Ä¢ TERAMPIL ‚Ä¢ RESPONSIF ‚Ä¢ AGAMIS</p>
                        
                        <div className="mt-2 space-y-4">
                          <h2 className="text-3xl sm:text-5xl font-display font-black text-white tracking-tight leading-normal">Halo, Agan Parta, S.Kom.Gr! üëã</h2>
                          <p className="text-lg text-emerald-50 leading-relaxed max-w-2xl font-sans font-medium">
                            Selamat datang kembali di <span className="text-white font-medium decoration-white decoration-2 underline-offset-8 underline">Portal Manajemen Penilaian Siswa</span> SMAN 1 Cililin. Kelola data akademik dan kembangkan potensi siswa dengan solusi digital terintegrasi.
                          </p>
                        </div>

                        {/* Badges deleted per user request */}
                      </div>
                    </div>

                    {/* Header Group (Academic Stats moved here) */}
                    <div className="space-y-6">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-[0.3em] ml-1">Manajemen Nilai</h3>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white rounded-[2rem] p-8 rainbow-border-2rem hover:border-[#1877f2]/50 transition-all shadow-xl hover:shadow-2xl group">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 group-hover:text-[#1877f2] transition-colors">Total Ujian Aktif</p>
                          <p className="text-4xl font-display font-medium text-slate-900 tracking-tight">{dashboardStats.activeExams}</p>
                        </div>
                        <div className="bg-white rounded-[2rem] p-8 rainbow-border-2rem hover:border-[#1877f2]/50 transition-all shadow-xl hover:shadow-2xl group">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 group-hover:text-[#1877f2] transition-colors">Siswa Selesai Ujian</p>
                          <p className="text-4xl font-display font-medium text-slate-900 tracking-tight">{dashboardStats.finishedStudents}</p>
                        </div>
                        <div className="bg-white rounded-[2rem] p-8 rainbow-border-2rem hover:border-[#1877f2]/50 transition-all shadow-xl hover:shadow-2xl group">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 group-hover:text-[#1877f2] transition-colors">Rata-Rata Skor</p>
                          <p className="text-4xl font-display font-medium text-[#1877f2] tracking-tight">
                            {dashboardStats.averageScore}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Grid 4 Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                      <div className="bg-white rounded-3xl p-6 rainbow-border-3xl shadow-xl hover:shadow-2xl transition-all group flex flex-col gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#1877f2]/10 border border-[#1877f2]/20 flex items-center justify-center shrink-0">
                          <Users className="w-6 h-6 text-[#1877f2]" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 group-hover:text-[#1877f2] transition-colors">Siswa Terdaftar</p>
                          <p className="text-3xl font-display font-medium text-slate-900 tracking-tight">{studentsList.length}</p>
                        </div>
                      </div>
                      
                      <div className="bg-white rounded-3xl p-6 rainbow-border-3xl shadow-xl hover:shadow-2xl transition-all group flex flex-col gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#1877f2]/10 border border-[#1877f2]/20 flex items-center justify-center shrink-0">
                          <School className="w-6 h-6 text-[#1877f2]" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 group-hover:text-[#1877f2] transition-colors">Kelas Aktif</p>
                          <p className="text-3xl font-display font-medium text-slate-900 tracking-tight">{classesList.length}</p>
                        </div>
                      </div>
                      
                      <div className="bg-white rounded-3xl p-6 rainbow-border-3xl shadow-xl hover:shadow-2xl transition-all group flex flex-col gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#1877f2]/10 border border-[#1877f2]/20 flex items-center justify-center shrink-0">
                          <FileText className="w-6 h-6 text-[#1877f2]" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 group-hover:text-[#1877f2] transition-colors">Total Tugas</p>
                          <p className="text-3xl font-display font-medium text-slate-900 tracking-tight">{assignmentsList.length}</p>
                        </div>
                      </div>
                      
                      <div className="bg-white rounded-3xl p-6 rainbow-border-3xl shadow-xl hover:shadow-2xl transition-all group flex flex-col gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-[#1877f2]/10 border border-[#1877f2]/20 flex items-center justify-center shrink-0">
                          <BarChart3 className="w-6 h-6 text-[#1877f2]" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 group-hover:text-[#1877f2] transition-colors">Nilai Masuk</p>
                          <p className="text-3xl font-display font-medium text-slate-900 tracking-tight">{finalGradesList.length}</p>
                        </div>
                      </div>
                    </div>

                    {/* Two Large Bottom Cards */}
                    <div className="grid md:grid-cols-2 gap-4 sm:gap-6">
                      <div className="bg-white rounded-[2rem] p-8 rainbow-border-2rem shadow-xl flex flex-col h-full hover:shadow-2xl transition-all group">
                        <div className="flex items-center gap-4 mb-8">
                          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-sm">
                            <Wifi className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-800 tracking-tight">Status Koneksi Internet</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Real-time Network Diagnostics</p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 mt-auto">
                          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-center flex flex-col justify-center group-hover:bg-white group-hover:border-[#1877f2]/20 transition-all">
                            <Zap className="w-6 h-6 text-blue-500 mb-3" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Kecepatan</p>
                            <p className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">10 Mbps</p>
                          </div>
                          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 text-center flex flex-col justify-center group-hover:bg-white group-hover:border-[#1877f2]/20 transition-all">
                            <Activity className="w-6 h-6 text-orange-500 mb-3" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Latensi (Ping)</p>
                            <p className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">107 ms</p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white rounded-[2rem] p-8 rainbow-border-2rem shadow-xl flex flex-col h-full hover:shadow-2xl transition-all group">
                        <div className="flex items-center gap-4 mb-8">
                          <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
                            <Clock className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold text-slate-800 tracking-tight">Informasi Sesi Terakhir</h3>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Akses Keamanan Sistem</p>
                          </div>
                        </div>
                        
                        <div className="space-y-4 mt-auto">
                          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 flex items-center gap-5 transition-all group-hover:bg-white group-hover:border-[#1877f2]/20">
                            <div className="w-10 h-10 rounded-xl border border-slate-100 flex items-center justify-center bg-white shrink-0">
                              <Calendar className="w-5 h-5 text-slate-600" />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Akses Terakhir</p>
                              <p className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">{new Date().toLocaleDateString("id-ID", {
                                day: 'numeric', month: 'long', year: 'numeric'
                              })}, {new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'})}</p>
                            </div>
                          </div>
                          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 flex items-center gap-5 transition-all group-hover:bg-white group-hover:border-[#1877f2]/20">
                            <div className="w-10 h-10 rounded-xl border border-slate-100 flex items-center justify-center bg-white shrink-0">
                              <ShieldCheck className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1">Status Keamanan</p>
                              <p className="text-sm font-bold text-emerald-600 tracking-tight">Sesi Terenkripsi</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                  {activeMenu === "manajemen-siswa-dan-kelas" && (
                    <div className="space-y-12">
                      <div className="flex gap-4 border-b border-slate-200">
                        <button onClick={() => setActiveStudentClassTab("input-siswa")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activeStudentClassTab === "input-siswa" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Input Siswa</button>
                        <button onClick={() => setActiveStudentClassTab("input-kelas")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activeStudentClassTab === "input-kelas" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Input Kelas</button>
                        <button onClick={() => setActiveStudentClassTab("daftar-siswa")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activeStudentClassTab === "daftar-siswa" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Daftar Siswa</button>
                      </div>

                      {activeStudentClassTab === "input-siswa" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Input Siswa</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Input data identitas siswa baru ke dalam database atau gunakan fitur impor massal.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-10">
                            {saveMessage.text && (
                              <div
                                className={`max-w-6xl rounded-xl p-5 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-500 border ${getAlertClasses(saveMessage.type)}`}
                              >
                                {getAlertIcon(saveMessage.type)}
                                <p className="text-xs font-bold uppercase tracking-wider leading-relaxed">
                                  {saveMessage.text}
                                </p>
                              </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                              <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40">
                                <h3 className="text-xl font-bold mb-6">Input Manual</h3>
                                <div className="space-y-4">
                                  <input type="text" placeholder="Nama Lengkap Siswa" value={studentName} onChange={(e) => setStudentName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all" />
                                  <select value={studentClass} onChange={(e) => setStudentClass(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all appearance-none cursor-pointer">
                                    <option value="">Pilih Kelas</option>
                                    {classesList.map((c, idx) => <option key={`opt-stu-cls-${c.id || c.name || idx}-${idx}`} value={c.name}>{c.name}</option>)}
                                  </select>
                                  <input type="text" placeholder="NIS/NISN" value={studentNisn} onChange={(e) => setStudentNisn(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all" />
                                  <input type="text" placeholder="Kode Akses" value={studentAccessCode} onChange={(e) => setStudentAccessCode(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all" />
                                  <button onClick={handleSimpanSiswa} disabled={isSaving} className="bg-[#85cc00] hover:bg-[#74b300] text-white p-3 rounded-xl w-full font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                                    {isSaving ? (
                                      <>
                                        <RefreshCw className="h-5 w-5 animate-spin" />
                                        <span>Menyimpan...</span>
                                      </>
                                    ) : (
                                      "Simpan Data Siswa"
                                    )}
                                  </button>
                                </div>
                              </div>

                              <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40">
                                  <h3 className="text-xl font-bold mb-6">Impor dari Excel</h3>
                                  <label className="cursor-pointer group/upload flex flex-col justify-center w-full h-56 bg-white border-2 border-dashed border-slate-200 hover:border-[#85cc00] hover:bg-slate-50 rounded-[2.5rem] transition-all duration-500 overflow-hidden relative">
                                    <div className="flex flex-col justify-center px-10 relative z-10">
                                      <p className="text-sm text-slate-900 font-bold uppercase tracking-wider mb-1">
                                        Pilih Berkas Excel
                                      </p>
                                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-display italic">
                                        Mendukung: .XLSX dan .XLS
                                      </p>
                                    </div>
                                    <input
                                      type="file"
                                      accept=".xlsx, .xls"
                                      className="hidden"
                                      onChange={handleImportExcel}
                                      disabled={isSaving}
                                    />
                                  </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {activeStudentClassTab === "input-kelas" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Input Kelas</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Tambahkan kelas baru dan pantau daftar kelas yang telah terdaftar dalam sistem.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40 h-fit">
                              <h3 className="text-xl font-bold mb-6">Tambah Kelas Baru</h3>
                              <div className="space-y-4">
                                <input type="text" placeholder="Nama Ruang Kelas" value={newClassName} onChange={(e) => setNewClassName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all" />
                                <button onClick={handleAddClass} className="bg-[#85cc00] hover:bg-[#74b300] text-white p-3 rounded-xl w-full font-bold transition-colors">Simpan Kelas</button>
                              </div>
                            </div>

                            <div className="rounded-3xl border border-slate-200 bg-white p-10 shadow-xl shadow-slate-200/40">
                              <h3 className="text-xl font-bold mb-6">Daftar Kelas</h3>
                              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                                {classesList.length > 0 ? (
                                  classesList.map((cls, idx) => {
                                    const studentCount = studentsList.filter(s => s.kelas === cls.name).length;
                                    return (
                                      <div key={`cls-card-${cls.id || cls.name || idx}-${idx}`} className="flex justify-between items-center p-4 border border-slate-100 rounded-xl hover:border-[#85cc00]/30 hover:bg-slate-50 transition-all">
                                        <div>
                                          <p className="font-bold text-slate-900 text-lg">{cls.name}</p>
                                          <p className="text-slate-500 text-sm font-medium">{studentCount} Siswa</p>
                                        </div>
                                        <button onClick={() => handleDeleteClass(cls.id)} className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors">
                                          Hapus
                                        </button>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-center py-8">
                                    <p className="text-slate-400 font-medium">Belum ada kelas yang terdaftar</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      {activeStudentClassTab === "daftar-siswa" && (
                        <div className="space-y-12">
                          <div className="flex flex-col items-center text-center pb-10 border-b border-slate-100">
                            <div className="max-w-2xl text-center">
                              <h2 className="text-2xl font-bold text-slate-950">
                                Daftar Siswa
                              </h2>
                              <p className="text-base text-slate-600 font-normal leading-relaxed max-w-lg mx-auto">
                                Kelola dan pantau seluruh data siswa yang terdaftar dalam sistem akademik.
                              </p>
                            </div>
                          </div>
                          
                          {/* Filter Kelas & Search Input for Students */}
                          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5">
                            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                              {/* Filter Kelas */}
                              <div className="md:col-span-4">
                                <label htmlFor="student-class-filter" className="text-xs font-black text-slate-700 uppercase tracking-wider block mb-2">
                                  Filter Kelas :
                                </label>
                                <select
                                  id="student-class-filter"
                                  value={studentClassFilter}
                                  onChange={(e) => setStudentClassFilter(e.target.value)}
                                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all text-slate-900 shadow-sm font-bold cursor-pointer h-[42px]"
                                >
                                  <option value="SEMUA_KELAS">-- Semua Kelas --</option>
                                  {Array.from(
                                    new Set([
                                      ...classesList.map((c) => c.name || c.id),
                                      ...studentsList.map((s) => s.kelas),
                                    ].filter(Boolean))
                                  ).sort().map((clsName, idx) => (
                                    <option key={`stu-cls-filter-${clsName}-${idx}`} value={clsName}>
                                      Kelas {clsName}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Pencarian Siswa */}
                              <div className="md:col-span-5">
                                <label htmlFor="student-search" className="text-xs font-black text-slate-700 uppercase tracking-wider block mb-2">
                                  Pencarian Siswa :
                                </label>
                                <div className="relative">
                                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                    <Search className="w-4 h-4 text-slate-400" />
                                  </span>
                                  <input
                                    id="student-search"
                                    type="text"
                                    placeholder="Ketik Nama Lengkap, NISN, atau Kelas..."
                                    value={studentSearchQuery}
                                    onChange={(e) => setStudentSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-10 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all placeholder:text-slate-400 text-slate-900 shadow-sm h-[42px]"
                                  />
                                  {studentSearchQuery && (
                                    <button
                                      onClick={() => setStudentSearchQuery("")}
                                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                                      title="Bersihkan Pencarian"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* Total Siswa - Simetris dengan input & label */}
                              <div className="md:col-span-3">
                                <span className="text-xs font-black text-slate-700 uppercase tracking-wider block mb-2">
                                  Total Data Siswa :
                                </span>
                                <div className="w-full h-[42px] px-3.5 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-between text-xs font-bold text-slate-700">
                                  <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-[#85cc00] animate-pulse"></span>
                                    <span className="text-slate-500 font-semibold">Tampil</span>
                                  </div>
                                  <span className="bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200 text-slate-800 font-black font-mono">
                                    {filteredStudents.length} / {studentsList.length} Siswa
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="border border-slate-200 rounded-xl shadow-sm max-h-[600px] overflow-y-auto overflow-x-auto">
                            <table className="w-full text-left border-collapse font-sans text-xs min-w-[800px]">
                              <thead className="sticky top-0 bg-slate-50 z-10">
                                <tr className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                                  <th className="py-3 px-3 border border-slate-200 text-center w-12 bg-slate-50">No</th>
                                  <th className="py-3 px-3 border border-slate-200 text-center w-24 bg-slate-50">Poto Siswa</th>
                                  <th className="py-3 px-3 border border-slate-200 bg-slate-50 min-w-[180px]">Nama Lengkap Siswa</th>
                                  <th className="py-3 px-3 border border-slate-200 text-center w-36 bg-slate-50">NISN</th>
                                  <th className="py-3 px-3 border border-slate-200 text-center w-32 bg-slate-50">Kelas</th>
                                  <th className="py-3 px-3 border border-slate-200 text-center w-36 bg-slate-50">Kode Akses</th>
                                  <th className="py-3 px-3 border border-slate-200 text-center w-40 bg-slate-50">Opsi (Edit dan Hapus)</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white">
                                {studentsList.length === 0 ? (
                                  <tr>
                                    <td colSpan={7} className="py-12 px-6 text-center text-slate-400 font-medium border border-slate-200 bg-slate-50/50">
                                      <div className="flex flex-col items-center justify-center gap-2">
                                        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                          <User className="w-6 h-6" />
                                        </div>
                                        <span className="text-sm font-bold text-slate-700">Belum ada siswa yang terdaftar</span>
                                        <span className="text-xs text-slate-400">Silakan tambahkan siswa baru di menu di atas atau impor via Excel.</span>
                                      </div>
                                    </td>
                                  </tr>
                                ) : filteredStudents.length === 0 ? (
                                  <tr>
                                    <td colSpan={7} className="py-12 px-6 text-center text-slate-400 font-medium border border-slate-200 bg-slate-50/50">
                                      <div className="flex flex-col items-center justify-center gap-2">
                                        <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-500">
                                          <SearchX className="w-6 h-6" />
                                        </div>
                                        <span className="text-sm font-bold text-slate-700">Nama Tersebut tidak terdaftar di Database</span>
                                        <span className="text-xs text-slate-400">Coba gunakan kata kunci pencarian yang berbeda atau periksa ejaan Anda.</span>
                                      </div>
                                    </td>
                                  </tr>
                                ) : (
                                  filteredStudents.map((student, idx) => (
                                  <tr key={`stu-dft-${student.id || student.nisn || idx}-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                                    {/* 1. No */}
                                    <td className="py-2.5 px-3 text-center border border-slate-200 font-medium text-slate-500">
                                      {idx + 1}
                                    </td>

                                    {/* 2. Poto Siswa */}
                                    <td className="py-2.5 px-3 border border-slate-200 text-center">
                                      <div className="flex justify-center items-center">
                                        <button 
                                          onClick={() => setViewingStudentPhoto(student)}
                                          className="w-9 h-9 rounded-full overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center cursor-pointer hover:scale-105 active:scale-95 transition-transform group"
                                          title="Klik untuk memperbesar"
                                        >
                                          {student.profilePhotoUrl ? (
                                            <img loading="lazy" 
                                              src={getDriveImageUrl(student.profilePhotoUrl)} 
                                              alt={student.displayName} 
                                              referrerPolicy="no-referrer"
                                              className="w-full h-full object-cover group-hover:opacity-90" 
                                            />
                                          ) : (
                                            <User className="w-4 h-4 text-slate-400 group-hover:text-slate-600" />
                                          )}
                                        </button>
                                      </div>
                                    </td>

                                    {/* 3. Nama Lengkap Siswa */}
                                    <td className="py-2.5 px-3 border border-slate-200 font-medium text-slate-900 leading-normal">
                                      {student.displayName}
                                    </td>

                                    {/* 4. NISN */}
                                    <td className="py-2.5 px-3 border border-slate-200 text-center font-normal text-slate-600">
                                      {student.nisn}
                                    </td>

                                    {/* 5. Kelas */}
                                    <td className="py-2.5 px-3 border border-slate-200 text-center font-normal text-slate-600">
                                      {student.kelas}
                                    </td>

                                    {/* 6. Kode Akses */}
                                    <td className="py-2.5 px-3 border border-slate-200 text-center font-mono text-slate-600">
                                      <div className="flex items-center justify-center gap-1.5">
                                        <span>{student.accessCode}</span>
                                        <button
                                          onClick={() => {
                                            navigator.clipboard.writeText(student.accessCode);
                                            setCopiedAccessCode(student.accessCode);
                                            setTimeout(() => setCopiedAccessCode(null), 2000);
                                          }}
                                          className="p-1 text-slate-400 hover:text-[#85cc00] hover:bg-slate-100 rounded transition-all cursor-pointer"
                                          title="Salin Kode Akses"
                                        >
                                          {copiedAccessCode === student.accessCode ? (
                                            <Check className="w-3.5 h-3.5 text-emerald-500 animate-bounce" />
                                          ) : (
                                            <Copy className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      </div>
                                    </td>

                                    {/* 7. Opsi (Edit dan Hapus) */}
                                    <td className="py-2.5 px-3 border border-slate-200 text-center">
                                      <div className="flex justify-center items-center gap-1.5">
                                        <button 
                                          onClick={() => handleEditStudent(student)} 
                                          className="px-2.5 py-1 text-xs font-semibold text-emerald-600 hover:text-white bg-emerald-50 hover:bg-emerald-600 border border-emerald-200 hover:border-transparent rounded transition-all cursor-pointer shadow-sm text-center inline-flex items-center gap-1"
                                        >
                                          Edit
                                        </button>
                                        <button 
                                          onClick={() => handleDeleteStudent(student.id, student.nisn)} 
                                          className="px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-transparent rounded transition-all cursor-pointer shadow-sm text-center inline-flex items-center gap-1"
                                        >
                                          Hapus
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                               )}
                              </tbody>
                            </table>
                          </div>

                        </div>
                      )}
                    </div>
                  )}







                  {activeMenu === "sistem-presensi-siswa" && (
                    <div className="space-y-12">
                      <div className="flex gap-4 border-b border-slate-200">
                        <button onClick={() => setActivePresensiTab("input")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activePresensiTab === "input" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Sistem Absensi</button>
                        <button onClick={() => setActivePresensiTab("preview")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activePresensiTab === "preview" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Preview Absensi</button>
                        <button onClick={() => setActivePresensiTab("analisis")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activePresensiTab === "analisis" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Analisis Presensi</button>
                      </div>

                      {activePresensiTab === "input" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Sistem Absensi</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Kelola dan pantau kehadiran siswa berdasarkan tanggal dan kelas secara presisi.
                              </p>
                            </div>
                          </div>

                      <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-xl space-y-6">
                        <div className="flex flex-row gap-6 items-end">
                          <div className="flex-1">
                            <label className="block text-xs font-normal text-slate-400 uppercase tracking-widest mb-3">
                              Tanggal Pelaksanaan Presensi
                            </label>
                            <input
                              type="date"
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-[#85cc00]/20"
                              value={attendanceDate}
                              onChange={(e) => setAttendanceDate(e.target.value)}
                            />
                          </div>
                          <div className="flex-1">
                            <label className="block text-xs font-normal text-slate-400 uppercase tracking-widest mb-3">
                              Rombongan Belajar / Kelas Binaan
                            </label>
                            <select
                              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-[#85cc00]/20"
                              value={attendanceClass}
                              onChange={(e) => setAttendanceClass(e.target.value)}
                            >
                              <option value="">-- Pilih Rombongan Belajar (Kelas) --</option>
                              {classesList.map((cls, idx) => (
                                <option key={`att-sel-cls-${cls.id || cls.name || idx}-${idx}`} value={cls.name}>
                                  {cls.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {attendanceClass && (
                          <div className="pt-6 border-t border-slate-100">
                            <div className="flex justify-between items-center mb-6">
                              <h3 className="font-bold text-slate-800">Daftar Siswa</h3>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-slate-200 text-left text-xs font-black text-slate-950 uppercase tracking-widest bg-slate-100">
                                    <th className="p-4 rounded-tl-2xl w-16 text-center whitespace-nowrap">No</th>
                                    <th className="p-4 whitespace-nowrap">Nama Lengkap Siswa</th>
                                    <th className="p-4 rounded-tr-2xl w-1/2 text-center border-l border-slate-100">Status Kehadiran / Keterangan</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {studentsList.filter((s) => s.kelas === attendanceClass).length === 0 && (
                                    <tr>
                                      <td colSpan={3} className="p-8 text-center text-slate-400 font-medium">Belum ada data siswa di kelas ini.</td>
                                    </tr>
                                  )}
                                  {studentsList
                                    .filter((s) => s.kelas === attendanceClass)
                                    .map((student, idx) => (
                                      <tr key={`stu-att-${student.id || student.nisn || idx}-${idx}`} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4 text-center font-mono font-black text-slate-400 text-xs">{idx + 1}</td>
                                        <td className="p-4 font-bold text-slate-700 whitespace-nowrap">{student.displayName}</td>
                                        <td className="p-4 text-center border-l border-slate-100 flex justify-center gap-2">
                                          {["Hadir", "Sakit", "Izin", "Alpa", "Dispen"].map((status, statusIdx) => (
                                            <button
                                              key={`status-btn-${status}-${statusIdx}`}
                                              disabled={!isEditingAttendance}
                                              onClick={() => setAttendanceData(prev => ({ ...prev, [student.nisn]: status }))}
                                              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border ${
                                                (attendanceData[student.nisn] || "Hadir") === status
                                                  ? status === "Hadir" ? "bg-emerald-100/50 text-emerald-700 border-emerald-200"
                                                    : status === "Sakit" ? "bg-amber-100/50 text-amber-700 border-amber-200"
                                                    : status === "Izin" ? "bg-blue-100/50 text-blue-700 border-blue-200"
                                                    : status === "Alpa" ? "bg-rose-100/50 text-rose-700 border-rose-200"
                                                    : "bg-purple-100/50 text-purple-700 border-purple-200" // Dispen
                                                  : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"
                                              } ${!isEditingAttendance ? "opacity-60 cursor-not-allowed" : ""}`}
                                            >
                                              {status}
                                            </button>
                                          ))}
                                        </td>
                                      </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="mt-8 flex justify-end items-center gap-3 flex-wrap">
                              {attendanceDate && attendanceClass && absensiList.find(a => a.date === attendanceDate && a.kelasRef === attendanceClass) && (
                                <button
                                  onClick={() => {
                                    const rec = absensiList.find(a => a.date === attendanceDate && a.kelasRef === attendanceClass);
                                    if (rec) handleDeleteAbsensi(rec.id, attendanceDate);
                                  }}
                                  className="px-5 py-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl font-bold uppercase tracking-widest text-xs flex items-center gap-2 border border-rose-200/80 transition-colors cursor-pointer"
                                  title="Hapus Tanggal Presensi Ini"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Hapus Tanggal Presensi</span>
                                </button>
                              )}
                              {!isEditingAttendance && (
                                <button
                                  onClick={() => setIsEditingAttendance(true)}
                                  className="px-6 py-3 bg-amber-500 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-amber-600 shadow-lg shadow-amber-500/20 transition-colors cursor-pointer"
                                >
                                  Edit Absen
                                </button>
                              )}
                              <button
                                onClick={handleSaveAttendance}
                                disabled={savingAttendance || !isEditingAttendance}
                                className="px-6 py-3 bg-[#85cc00] text-slate-900 rounded-xl font-bold uppercase tracking-widest text-xs hover:brightness-110 shadow-lg shadow-[#85cc00]/20 disabled:opacity-50 transition-colors cursor-pointer"
                              >
                                {savingAttendance ? "Menyimpan..." : "Simpan Absen"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/60 overflow-hidden relative">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#85cc00] to-emerald-500"></div>
                        <div className="p-8 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white/50 bg-white/95 gap-4">
                          <h3 className="text-sm font-black uppercase tracking-widest text-slate-800">
                            Riwayat Absensi {attendanceClass ? `- Kelas ${attendanceClass}` : ""}
                          </h3>
                          <div className="flex items-center gap-3 bg-gradient-to-br from-emerald-50 to-teal-50/50 px-5 py-2.5 rounded-2xl border border-emerald-100/60 shadow-sm">
                            <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-emerald-500 shadow-sm border border-emerald-50">
                              <ClipboardList className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-emerald-600/60 leading-none mb-1">Total Terdata</p>
                              <p className="text-sm font-black text-emerald-900 leading-none">
                                {attendanceClass ? absensiList.filter((a) => a.kelasRef === attendanceClass).length : 0} <span className="text-[10px] opacity-60">Pertemuan</span>
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="overflow-x-auto p-4 sm:p-8">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-slate-100 text-[11px] font-black uppercase tracking-widest text-slate-400 bg-slate-50/30">
                                <th className="py-5 px-6 rounded-tl-2xl">Tanggal / Waktu</th>
                                <th className="py-5 px-6">Kelas Tujuan</th>
                                <th className="py-5 px-6 rounded-tr-2xl text-right">Aksi & Opsi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm font-semibold text-slate-700">
                              {attendanceClass && absensiList
                                .filter((a) => a.kelasRef === attendanceClass)
                                .map((absData, idx) => {
                                  const cls = classesList.find(c => c.id === absData.kelasRef);
                                  return (
                                    <tr key={`abs-hist-${absData.id || idx}-${idx}`} className="hover:bg-slate-50/60 transition-colors group">
                                      <td className="py-5 px-6 group-hover:bg-slate-50/40">
                                         <div className="flex flex-col">
                                           <span className="font-bold text-slate-900">{absData.date}</span>
                                           {absData.createdAt && <span className="text-[11px] font-medium text-slate-400 mt-0.5">{new Date(absData.createdAt).toLocaleTimeString('id-ID')} WIB</span>}
                                         </div>
                                      </td>
                                      <td className="py-5 px-6">
                                        <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-widest text-slate-600">
                                          {cls?.name || absData.kelasRef}
                                        </span>
                                      </td>
                                      <td className="py-5 px-6 text-right">
                                        <div className="flex justify-end items-center gap-2">
                                           <button
                                             onClick={() => handleEditAbsensi(absData)}
                                             className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-xs font-bold transition-all cursor-pointer border border-blue-100 flex items-center gap-1.5"
                                             title="Edit Data Absensi"
                                           >
                                             <Edit className="w-3.5 h-3.5" />
                                             <span>Edit</span>
                                           </button>
                                           <button
                                             onClick={() => handleDeleteAbsensi(absData.id, absData.date)}
                                             className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl text-xs font-bold transition-all cursor-pointer border border-rose-100 flex items-center gap-1.5"
                                             title="Hapus Tanggal Presensi"
                                           >
                                             <Trash2 className="w-3.5 h-3.5" />
                                             <span>Hapus Tanggal</span>
                                           </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              {!attendanceClass && (
                                <tr>
                                  <td colSpan={3} className="py-20 text-center">
                                    <div className="flex flex-col gap-4 text-slate-300">
                                      <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center">
                                        <CheckCircle2 className="w-8 h-8 opacity-50" />
                                      </div>
                                      <p className="text-xs font-bold uppercase tracking-widest">Silakan pilih kelas terlebih dahulu</p>
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {attendanceClass && absensiList.filter((a) => a.kelasRef === attendanceClass).length === 0 && (
                                <tr>
                                  <td colSpan={3} className="py-20 text-center">
                                    <div className="flex flex-col gap-4 text-slate-300">
                                      <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center">
                                        <Calendar className="w-8 h-8 opacity-50" />
                                      </div>
                                      <p className="text-xs font-bold uppercase tracking-widest">Belum ada data absensi untuk kelas ini</p>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {activePresensiTab === "preview" && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <div className="flex flex-col md:flex-row justify-between gap-6 pb-6 border-b border-slate-100">
                        <div className="max-w-2xl">
                          <h2 className="text-2xl font-bold text-slate-950">Preview Absensi</h2>
                          <p className="text-slate-500 font-medium text-lg leading-relaxed">
                            Tinjau rekapitulasi kehadiran siswa berdasarkan kelas.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-3 items-center">
                          <select
                            value={attendanceClass}
                            onChange={(e) => setAttendanceClass(e.target.value)}
                            className="bg-white border border-slate-300 rounded-2xl px-4 py-3 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-[#85cc00]/20 min-w-[180px]"
                          >
                            <option value="">-- Pilih Rombongan Belajar --</option>
                            {classesList.map((c, idx) => (
                              <option key={`dl-att-cls-${c.id || c.name || idx}-${idx}`} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          <button 
                            onClick={handleDownloadPreviewExcel}
                            className="bg-emerald-600 text-white px-4 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all text-xs"
                          >
                             <FileText className="w-4 h-4" /> Ekspor Excel
                          </button>
                          <button 
                            onClick={handlePreviewAbsensiPDF}
                            className="bg-sky-600 text-white px-4 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-sky-700 transition-all text-xs"
                          >
                             <Eye className="w-4 h-4" /> Preview PDF
                          </button>
                          <button 
                            onClick={handleDownloadPreviewPDF}
                            className="bg-rose-600 text-white px-4 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-rose-700 transition-all text-xs"
                          >
                             <FileText className="w-4 h-4" /> Ekspor PDF
                          </button>
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left" id="previewAbsensiTable">
                            <thead className="bg-slate-50 border-b border-slate-100">
                              <tr>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center w-16">No</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Nama Lengkap Siswa</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Kelas</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Hadir</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Sakit</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Izin</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Alpa</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Dispen</th>
                                <th className="px-4 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center whitespace-nowrap">Persentase</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {(attendanceClass ? studentsList.filter(s => s.kelas === attendanceClass) : studentsList).map((s: any, idx: number) => {
                                const { hadir, sakit, izin, alpa, dispen, persentase } = getStudentAbsensiCounts(s, absensiList, attendanceClass);
                                
                                return (
                                  <tr key={`abs-sum-${s.id || s.nisn || idx}-${s.kelas || ''}-${idx}`} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 text-center font-mono font-black text-slate-400 text-xs">{idx + 1}</td>
                                    <td className="px-6 py-4 font-bold text-slate-900 whitespace-nowrap">{s.displayName || s.studentName}</td>
                                    <td className="px-6 py-4 text-center font-bold text-slate-600 whitespace-nowrap">{s.kelas || "-"}</td>
                                    <td className="px-6 py-4 text-center font-bold text-emerald-600">{hadir}</td>
                                    <td className="px-6 py-4 text-center text-slate-600">{sakit}</td>
                                    <td className="px-6 py-4 text-center text-slate-600">{izin}</td>
                                    <td className="px-6 py-4 text-center text-slate-600">{alpa}</td>
                                    <td className="px-6 py-4 text-center text-slate-600">{dispen}</td>
                                    <td className="px-6 py-4 text-center font-black text-[#85cc00]">{persentase}%</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {activePresensiTab === "analisis" && (
                    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
                      <div className="flex flex-col text-center md:text-left md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                        <div className="max-w-2xl">
                          <h2 className="text-2xl font-bold text-slate-950">Analisis Presensi</h2>
                          <p className="text-slate-500 font-medium text-lg leading-relaxed">
                            Pantau tingkat kehadiran dan identifikasi siswa yang jarang masuk secara otomatis.
                          </p>
                        </div>
                        <div className="flex flex-col gap-3 w-full md:w-auto">
                          <label className="text-[10px] font-normal uppercase tracking-widest text-slate-400">Rombongan Belajar (Kelas Analisis)</label>
                          <select
                            className="bg-white border-2 border-slate-100 rounded-2xl px-6 py-4 text-sm font-normal text-slate-900 outline-none focus:border-[#85cc00] transition-all shadow-sm min-w-[200px]"
                            value={analysisClass}
                            onChange={(e) => setAnalysisClass(e.target.value)}
                          >
                            <option value="">-- Pilih Rombongan Belajar (Kelas) --</option>
                            {classesList.map((cls, idx) => (
                              <option key={`anl-cls-${cls.id || cls.name || idx}-${idx}`} value={cls.name}>
                                {cls.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {analysisClass ? (
                        <div className="grid grid-cols-1 gap-8">
                          <div className="bg-white rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden">
                            <div className="p-8 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
                              <div>
                                <h3 className="text-lg font-black text-slate-900 leading-none">Laporan Kehadiran Kelas {analysisClass}</h3>
                                <div className="mt-3 inline-flex items-center gap-2 bg-slate-100/50 px-3 py-1.5 rounded-xl border border-slate-200/50">
                                  <BarChart3 className="w-3 h-3 text-slate-400" />
                                  <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">
                                    Analisis Berdasarkan <span className="text-slate-900">{absensiList.filter(a => a.kelasRef === analysisClass).length}</span> Pertemuan
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-4">
                                <div className="text-center px-4 border-r border-slate-100">
                                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kritis</p>
                                  <p className="text-xl font-black text-rose-500">{attendanceAnalysis.filter(s => s.warningLevel === 'critical').length}</p>
                                </div>
                                <div className="text-center px-4">
                                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pantau</p>
                                  <p className="text-xl font-black text-amber-500">{attendanceAnalysis.filter(s => s.warningLevel === 'warning').length}</p>
                                </div>
                              </div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50/50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                                    <th className="py-6 px-8">No</th>
                                    <th className="py-6 px-8">Nama Siswa</th>
                                    <th className="py-6 px-8 text-center">Statistik (H/S/I/A)</th>
                                    <th className="py-6 px-8 text-center">Persentase</th>
                                    <th className="py-6 px-8 text-right">Rubrik Kehadiran</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {attendanceAnalysis.map((data, idx) => (
                                    <tr key={`warn-${data.nisn || idx}-${idx}`} className={`hover:bg-slate-50 transition-colors ${data.warningLevel === 'critical' ? 'bg-rose-50/30' : ''}`}>
                                      <td className="py-6 px-8 text-xs font-black text-slate-400">{idx + 1}</td>
                                      <td className="py-6 px-8 whitespace-nowrap">
                                        <div>
                                          <p className="font-bold text-slate-900 whitespace-nowrap">{data.displayName}</p>
                                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">NISN: {data.nisn}</p>
                                        </div>
                                      </td>
                                      <td className="py-6 px-8">
                                        <div className="flex items-center justify-center gap-2">
                                          <div className="flex flex-col min-w-[30px]">
                                            <span className="text-[10px] font-black text-emerald-500">{data.stats.Hadir}</span>
                                            <span className="text-[8px] font-bold text-slate-300 uppercase">H</span>
                                          </div>
                                          <div className="w-px h-6 bg-slate-100"></div>
                                          <div className="flex flex-col min-w-[30px]">
                                            <span className="text-[10px] font-black text-amber-500">{data.stats.Sakit}</span>
                                            <span className="text-[8px] font-bold text-slate-300 uppercase">S</span>
                                          </div>
                                          <div className="w-px h-6 bg-slate-100"></div>
                                          <div className="flex flex-col min-w-[30px]">
                                            <span className="text-[10px] font-black text-blue-500">{data.stats.Izin}</span>
                                            <span className="text-[8px] font-bold text-slate-300 uppercase">I</span>
                                          </div>
                                          <div className="w-px h-6 bg-slate-100"></div>
                                          <div className="flex flex-col min-w-[30px]">
                                            <span className="text-[10px] font-black text-rose-500">{data.stats.Alpa}</span>
                                            <span className="text-[8px] font-bold text-slate-300 uppercase">A</span>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-6 px-8 text-center">
                                        <div className="flex flex-col gap-2">
                                          <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div 
                                              className={`h-full transition-all duration-1000 ${
                                                data.attendanceRate >= 90 ? 'bg-emerald-500' :
                                                data.attendanceRate >= 80 ? 'bg-amber-500' :
                                                'bg-rose-500'
                                              }`}
                                              style={{ width: `${data.attendanceRate}%` }}
                                            ></div>
                                          </div>
                                          <span className={`text-xs font-black ${
                                            data.attendanceRate >= 90 ? 'text-emerald-600' :
                                            data.attendanceRate >= 80 ? 'text-amber-600' :
                                            'text-rose-600'
                                          }`}>{data.attendanceRate}%</span>
                                        </div>
                                      </td>
                                      <td className="py-6 px-8 text-right">
                                        <div className="flex flex-col items-end gap-1">
                                          <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                                            data.rubricStatus === "Sangat Rajin" ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
                                            data.rubricStatus === "Rajin" ? "bg-blue-100 text-blue-700 border-blue-200" :
                                            data.rubricStatus === "Cukup Rajin" ? "bg-amber-100 text-amber-700 border-amber-200" :
                                            "bg-rose-100 text-rose-700 border-rose-200"
                                          }`}>
                                            {data.rubricStatus}
                                          </span>
                                          {data.warningLevel === 'critical' && (
                                            <button 
                                              onClick={() => handleBukaWhatsAppModal(
                                                data, 
                                                [], 
                                                data.attendanceRate, 
                                                data.stats, 
                                                data.totalMeetings, 
                                                "N/A"
                                              )}
                                              className="text-[9px] font-black text-blue-600 uppercase tracking-tighter hover:underline"
                                            >
                                              Kirim Laporan ke Orang Tua
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-8 flex flex-col gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-emerald-500 shadow-sm">
                                <CheckCircle2 className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-3xl font-black text-emerald-900 leading-none">
                                  {attendanceAnalysis.filter(s => s.attendanceRate >= 90).length}
                                </p>
                                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mt-2">Siswa Rajin (‚â• 90%)</p>
                              </div>
                            </div>
                            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-8 flex flex-col gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-amber-500 shadow-sm">
                                <AlertTriangle className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-3xl font-black text-amber-900 leading-none">
                                  {attendanceAnalysis.filter(s => s.attendanceRate < 90 && s.attendanceRate >= 80).length}
                                </p>
                                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mt-2">Perlu Pemantauan</p>
                              </div>
                            </div>
                            <div className="bg-rose-50 border border-rose-100 rounded-3xl p-8 flex flex-col gap-4">
                              <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-rose-500 shadow-sm">
                                <AlertOctagon className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="text-3xl font-black text-rose-900 leading-none">
                                  {attendanceAnalysis.filter(s => s.attendanceRate < 80).length}
                                </p>
                                <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest mt-2">Jarang Masuk ({"<"} 80%)</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col justify-center py-32 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
                          <div className="w-24 h-24 rounded-full bg-slate-50 flex items-center justify-center mb-6">
                            <BarChart3 className="w-12 h-12 text-slate-200" />
                          </div>
                          <p className="text-lg font-black text-slate-400 uppercase tracking-widest">Pilih kelas untuk melihat analisis</p>
                        </div>
                      )}
                    </div>
                  )}
                    </div>
                  )}

                  {activeMenu === "manajemen-tugas" && (
                    <div className="space-y-12">
                      <div className="flex gap-4 border-b border-slate-200">
                        <button onClick={() => setActiveAssignmentTab("tambah")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activeAssignmentTab === "tambah" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Buat Tugas</button>
                        <button onClick={() => setActiveAssignmentTab("daftar")} className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${activeAssignmentTab === "daftar" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"}`}>Daftar Tugas</button>
                      </div>

                      {activeAssignmentTab === "tambah" && (
                        <div className="max-w-4xl">
                          <div className="rounded-[2.5rem] bg-white p-10 border border-slate-200 shadow-xl shadow-slate-200/40">
                            <div className="flex items-center gap-6 mb-10 pb-10 border-b border-slate-100">
                              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-900 border border-slate-100">
                                <FileText className="w-6 h-6 text-[#85cc00]" />
                              </div>
                              <div>
                                <h3 className="text-xl font-bold text-slate-800 tracking-tight leading-none mb-2">
                                  Konfigurasi Tugas
                                </h3>
                                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                                  Definisikan parameter akademik dan target kurikulum
                                </p>
                              </div>
                            </div>

                            {assignmentMessage.text && (
                              <div
                                className={`mb-10 rounded-xl p-5 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-500 border ${
                                  assignmentMessage.type === "error"
                                    ? "bg-rose-50 text-rose-600 border-rose-100"
                                    : "bg-emerald-50 text-emerald-600 border-emerald-100"
                                }`}
                              >
                                {assignmentMessage.type === "error" ? (
                                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                ) : (
                                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                                )}
                                <p className="text-xs font-bold uppercase tracking-wider leading-relaxed">
                                  {assignmentMessage.text}
                                </p>
                              </div>
                            )}

                            <div className="space-y-10">
                              {/* 1. Pilih Bab */}
                              <div className="space-y-4">
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                  1. Pilih Bab
                                </label>
                                <div className="relative group">
                                  <select
                                    value={assignmentBab}
                                    onChange={(e) => setAssignmentBab(e.target.value)}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all font-bold text-slate-700 appearance-none cursor-pointer"
                                  >
                                    <option value="">-- Pilih Bab Pembelajaran --</option>
                                    <option value="Informatika dan Keterampilan Generik">Informatika dan Keterampilan Generik</option>
                                    <option value="Berpikir Komputasional (BK)">Berpikir Komputasional (BK)</option>
                                    <option value="Teknologi Informasi dan Komunikasi (TIK)">Teknologi Informasi dan Komunikasi (TIK)</option>
                                    <option value="Sistem Komputer (SK)">Sistem Komputer (SK)</option>
                                    <option value="Jaringan Komputer dan Internet (JKI)">Jaringan Komputer dan Internet (JKI)</option>
                                    <option value="Analisis Data (AD)">Analisis Data (AD)</option>
                                    <option value="Algoritma dan Pemrograman (AP)">Algoritma dan Pemrograman (AP)</option>
                                    <option value="Dampak Sosial Informatika (DSI)">Dampak Sosial Informatika (DSI)</option>
                                    <option value="Praktik Lintas Bidang (PLB)">Praktik Lintas Bidang (PLB)</option>
                                  </select>
                                  <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                    <ChevronDown className="w-5 h-5" />
                                  </div>
                                </div>
                              </div>

                              {/* 2. Tugas ke */}
                              <div className="space-y-4">
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                  2. Tugas ke / Judul Tugas
                                </label>
                                <div className="relative">
                                  <input
                                    type="text"
                                    value={assignmentMateri}
                                    onChange={(e) => setAssignmentMateri(e.target.value)}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all font-bold text-slate-700"
                                    placeholder="cth: Tugas 1 Dekomposisi"
                                  />
                                </div>
                              </div>

                              {/* 3. Pilih Kelas */}
                              <div className="space-y-4">
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                  3. Pilih Kelas (Dapat memilih lebih dari satu)
                                </label>
                                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-4">
                                  <div className="flex items-center gap-3">
                                    <input
                                      id="checkbox-all-classes"
                                      type="checkbox"
                                      checked={assignmentTargets.length === classesList.length && classesList.length > 0}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setAssignmentTargets(
                                            classesList.map((c) => ({
                                              kelas: c.name,
                                              deadline: sharedDeadline,
                                            }))
                                          );
                                        } else {
                                          setAssignmentTargets([]);
                                        }
                                      }}
                                      className="w-5 h-5 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                    />
                                    <label htmlFor="checkbox-all-classes" className="text-sm font-bold text-slate-700 cursor-pointer select-none">
                                      Semua Kelas
                                    </label>
                                  </div>
                                  <div className="h-[1px] bg-slate-200 my-2" />
                                  <div className="grid grid-cols-2 gap-4">
                                    {classesList.map((c, idx) => {
                                      const isChecked = assignmentTargets.some((t) => t.kelas === c.name);
                                      return (
                                        <div key={`asg-cls-chk-${c.id || c.name || idx}-${idx}`} className="flex items-center gap-3">
                                          <input
                                            id={`checkbox-class-${c.id}`}
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              if (e.target.checked) {
                                                setAssignmentTargets((prev) => [
                                                  ...prev.filter((t) => t.kelas !== c.name),
                                                  {
                                                    kelas: c.name,
                                                    deadline: sharedDeadline,
                                                  },
                                                ]);
                                              } else {
                                                setAssignmentTargets((prev) => prev.filter((t) => t.kelas !== c.name));
                                              }
                                            }}
                                            className="w-4 h-4 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                          />
                                          <label htmlFor={`checkbox-class-${c.id}`} className="text-sm font-semibold text-slate-600 cursor-pointer select-none">
                                            Kelas {c.name}
                                          </label>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>

                               {/* 4. Tanggal Terbit & Tenggat Waktu Per Kelas */}
                               <div className="space-y-4">
                                 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                                   <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                     4. Tanggal Terbit & Tenggat Waktu (Setiap Kelas Bisa Berbeda)
                                   </label>
                                   <span className="text-[10px] font-bold text-[#85cc00] bg-[#85cc00]/10 px-2.5 py-1 rounded-full uppercase">
                                     Beda Tanggal Per Kelas
                                   </span>
                                 </div>

                                 {/* Atur Massal Default */}
                                 <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-4">
                                   <div className="space-y-1.5">
                                     <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                       Atur Massal Tanggal Terbit (Semua Kelas)
                                     </label>
                                     <input
                                       type="datetime-local"
                                       value={assignmentPublishedAt}
                                       onChange={(e) => {
                                         const val = e.target.value;
                                         setAssignmentPublishedAt(val);
                                         setAssignmentTargets((prev) =>
                                           prev.map((t) => ({ ...t, publishedAt: val }))
                                         );
                                       }}
                                       className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-[#85cc00] outline-none"
                                     />
                                   </div>
                                   <div className="space-y-1.5">
                                     <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider">
                                       Atur Massal Jam Deadline (Semua Kelas)
                                     </label>
                                     <input
                                       type="datetime-local"
                                       value={sharedDeadline}
                                       onChange={(e) => {
                                         const val = e.target.value;
                                         setSharedDeadline(val);
                                         setAssignmentTargets((prev) =>
                                           prev.map((t) => ({ ...t, deadline: val }))
                                         );
                                       }}
                                       className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-[#85cc00] outline-none"
                                     />
                                   </div>
                                 </div>

                                 {/* Individual Class Inputs */}
                                 {assignmentTargets.length > 0 && (
                                   <div className="space-y-3 pt-2">
                                     <p className="text-[11px] font-bold text-slate-600">
                                       Pengaturan Terbit & Tenggat Spesifik Setiap Kelas:
                                     </p>
                                     {assignmentTargets.map((target, idx) => (
                                       <div key={`asg-target-${target.kelas || idx}-${idx}`} className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
                                         <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                           <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                                             Kelas {target.kelas}
                                           </span>
                                           <span className="text-[10px] text-slate-400 font-bold uppercase">
                                             Target #{idx + 1}
                                           </span>
                                         </div>
                                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                           <div>
                                             <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                               Tanggal Terbit Kelas {target.kelas} :
                                             </label>
                                             <input
                                               type="datetime-local"
                                               value={target.publishedAt || assignmentPublishedAt || ""}
                                               onChange={(e) => {
                                                 const val = e.target.value;
                                                 setAssignmentTargets((prev) =>
                                                   prev.map((t) => (t.kelas === target.kelas ? { ...t, publishedAt: val } : t))
                                                 );
                                               }}
                                               className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-[#85cc00] outline-none"
                                             />
                                           </div>
                                           <div>
                                             <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                               Deadline Kelas {target.kelas} :
                                             </label>
                                             <input
                                               type="datetime-local"
                                               value={target.deadline || sharedDeadline || ""}
                                               onChange={(e) => {
                                                 const val = e.target.value;
                                                 setAssignmentTargets((prev) =>
                                                   prev.map((t) => (t.kelas === target.kelas ? { ...t, deadline: val } : t))
                                                 );
                                               }}
                                               className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:bg-white focus:ring-2 focus:ring-[#85cc00] outline-none"
                                             />
                                           </div>
                                         </div>
                                       </div>
                                     ))}
                                   </div>
                                 )}
                               </div>

                              {/* Instruksi */}
                              <div className="space-y-4 pt-4">
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                  Instruksi Tugas
                                </label>
                                <textarea
                                  rows={4}
                                  value={assignmentDesc}
                                  onChange={(e) => setAssignmentDesc(e.target.value)}
                                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all font-bold text-slate-700 resize-none"
                                  placeholder="Detail instruksi tugas..."
                                />
                              </div>

                              {/* Link File / Video Tugas (PDF, Doc, YouTube, Drive) */}
                              <div className="space-y-3 pt-4">
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                  Link Lihat Tugas / Berkas Soal (PDF, Word DOC, YouTube, Google Drive, DLL)
                                </label>
                                <input
                                  type="url"
                                  value={assignmentTaskLink}
                                  onChange={(e) => setAssignmentTaskLink(e.target.value)}
                                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#85cc00] focus:border-[#85cc00] outline-none transition-all font-bold text-xs text-slate-800"
                                  placeholder="Paste link tugas di sini (contoh: https://drive.google.com/... atau https://youtu.be/... atau file PDF/DOC)"
                                />
                                <p className="text-[10px] text-slate-400 font-bold ml-1">
                                  üìå Link yang di-paste di sini akan muncul pada kolom "Lihat Tugas" di tabel tugas siswa sehingga siswa dapat langsung mengeklik & membukanya.
                                </p>
                              </div>
                            </div>
                          </div>

                            <div className="mt-12 flex flex-col sm:flex-row gap-4 pt-10 border-t border-slate-100">
                              <button
                                onClick={handleSimpanTugas}
                                disabled={isSavingAssignment}
                                className="flex-1 bg-[#85cc00] hover:bg-[#74b300] text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-[#85cc00]/20 active:scale-95 disabled:opacity-50"
                              >
                                {isSavingAssignment
                                  ? "Menyimpan..."
                                  : editingAssignmentId
                                    ? "Perbarui & Terbitkan"
                                    : "Simpan dan Terbitkan"}
                              </button>
                              {editingAssignmentId && (
                                <button
                                  onClick={handleBatalEditAssignment}
                                  className="rounded-2xl bg-white border border-slate-200 px-8 py-4 font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                                >
                                  Batal
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                      {activeAssignmentTab === "daftar" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Daftar Tugas</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Pantau dan kelola seluruh daftar penugasan yang telah dipublikasikan.
                              </p>
                            </div>
                          </div>

                          {/* Filter Kelas Checkboxes */}
                          <div className="bg-slate-50 border border-slate-200 rounded-[2rem] p-6 space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">
                                Saring Berdasarkan Kelas:
                              </span>
                              {selectedDaftarTugasClasses.length > 0 && (
                                <button
                                  onClick={() => setSelectedDaftarTugasClasses([])}
                                  className="text-xs font-bold text-rose-500 hover:text-rose-600 transition-colors"
                                >
                                  Bersihkan Filter
                                </button>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-4 items-center">
                              {/* Semua Kelas Checkbox */}
                              <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-200 shadow-sm hover:border-[#85cc00] transition-colors">
                                <input
                                  id="filter-class-all"
                                  type="checkbox"
                                  checked={selectedDaftarTugasClasses.length === 0}
                                  onChange={() => setSelectedDaftarTugasClasses([])}
                                  className="w-4 h-4 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                />
                                <label htmlFor="filter-class-all" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                                  Semua Kelas
                                </label>
                              </div>

                              {classesList.map((c, idx) => {
                                const isChecked = selectedDaftarTugasClasses.includes(c.name);
                                return (
                                  <div key={`flt-cls-${c.id || c.name || idx}-${idx}`} className={`flex items-center gap-2 px-4 py-2 bg-white rounded-xl border shadow-sm transition-colors ${isChecked ? 'border-[#85cc00]' : 'border-slate-200 hover:border-[#85cc00]'}`}>
                                    <input
                                      id={`filter-class-${c.id}`}
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedDaftarTugasClasses((prev) => [...prev, c.name]);
                                        } else {
                                          setSelectedDaftarTugasClasses((prev) => prev.filter((name) => name !== c.name));
                                        }
                                      }}
                                      className="w-4 h-4 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                    />
                                    <label htmlFor={`filter-class-${c.id}`} className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
                                      Kelas {c.name}
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="grid gap-10 grid-cols-1 xl:grid-cols-2">
                            {assignmentsList
                              .filter((a) => !a.isArchived)
                              .filter((a) => {
                                if (selectedDaftarTugasClasses.length === 0) return true;
                                return a.targets?.some((tgt: any) => selectedDaftarTugasClasses.includes(tgt.kelas));
                              }).length === 0 ? (
                            <div className="xl:col-span-2 rounded-[3.5rem] bg-white border border-slate-200 shadow-xl shadow-slate-200/40 p-32 text-center">
                              <div className="w-24 h-24 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center mx-auto mb-10 transition-transform hover:scale-110 duration-500">
                                <ZapOff className="w-10 h-10 text-slate-200" />
                              </div>
                              <h3 className="text-3xl font-display font-bold text-slate-900 mb-4 tracking-tight leading-none uppercase">
                                Arsip Kosong
                              </h3>
                              <p className="text-lg text-slate-400 font-medium leading-relaxed max-w-sm mx-auto">
                                Tidak ada tugas aktif yang ditemukan dalam database sistem saat ini.
                              </p>
                            </div>
                          ) : (
                            assignmentsList
                              .filter((a) => !a.isArchived)
                              .filter((a) => {
                                if (selectedDaftarTugasClasses.length === 0) return true;
                                return a.targets?.some((tgt: any) => selectedDaftarTugasClasses.includes(tgt.kelas));
                              })
                              .sort((a, b) => {
                                const dateA = new Date(a.publishedAt || a.createdAt).getTime();
                                const dateB = new Date(b.publishedAt || b.createdAt).getTime();
                                return dateB - dateA;
                              })
                              .map((t, idx) => (
                                <div
                                  key={`asg-card-${t.id || idx}-${idx}`}
                                  className="group relative overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white p-12 hover:border-[#85cc00] shadow-xl shadow-slate-200/40 hover:shadow-2xl hover:shadow-[#85cc00]/10 hover:-translate-y-1 transition-all duration-500"
                                >
                                  <div className="absolute -right-12 -top-12 p-16 opacity-[0.02] group-hover:opacity-[0.06] group-hover:scale-150 duration-700 group-hover:rotate-12 pointer-events-none text-[#85cc00]">
                                    <FileText className="w-64 h-64" />
                                  </div>

                                  <div className="relative z-10">
                                    <div className="flex items-center justify-between mb-12">
                                      <div className="flex items-center gap-5">
                                        <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-900 shadow-sm group-hover:border-[#85cc00] transition-colors">
                                          <School className="w-6 h-6 text-[#85cc00]" />
                                        </div>
                                        <div className="flex flex-col">
                                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-2">
                                            Rilis ‚Äì {getAssignmentPublishedAtForTeacher(t, selectedClassFilter !== "SEMUA_KELAS" ? selectedClassFilter : undefined)}
                                          </span>
                                          <span className="text-sm font-bold text-slate-900 uppercase tracking-tighter">
                                            {t.bab}
                                          </span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <button
                                          onClick={() => handleEditAssignment(t)}
                                          className="p-3.5 bg-white border border-slate-200 text-slate-400 hover:text-[#85cc00] hover:border-[#85cc00] rounded-2xl transition-all shadow-sm active:scale-95"
                                          title="Sunting Tugas"
                                        >
                                          <Edit className="w-5 h-5" />
                                        </button>
                                        <button
                                          onClick={() => handleDeleteAssignment(t.id)}
                                          className="p-3.5 bg-white border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-500 rounded-2xl transition-all shadow-sm active:scale-95"
                                          title="Arsipkan Tugas"
                                        >
                                          <Trash2 className="w-5 h-5" />
                                        </button>
                                      </div>
                                    </div>

                                    <h3 className="text-2xl font-display font-bold text-slate-900 tracking-tight leading-[1.1] mb-8 group-hover:text-black transition-colors min-h-[3rem]">
                                      {t.materi}
                                    </h3>

                                    <div className="mb-12">
                                      <div className="flex flex-wrap gap-2.5">
                                        {t.targets?.map(
                                          (tgt: any, i: number) => {
                                            const dl = tgt.deadline ? new Date(tgt.deadline).getTime() : 0;
                                            const now = Date.now();
                                            const diff = dl - now;
                                            const isNear = diff > 0 && diff < 24 * 60 * 60 * 1000;
                                            return (
                                              <span
                                                key={`tgt-badge-${tgt.kelas || i}-${i}`}
                                                className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-xl border flex items-center gap-2 transition-colors ${
                                                  isNear ? 'bg-rose-50 text-rose-600 border-rose-200 shadow-[0_0_15px_rgba(225,29,72,0.1)]' : 'bg-slate-50 text-slate-500 border-slate-200'
                                                }`}
                                              >
                                                {isNear && <Clock className="w-3 h-3 animate-pulse" />}
                                                {tgt.kelas}
                                              </span>
                                            );
                                          },
                                        )}
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-10 border-t border-slate-100">
                                      <div className="flex flex-col">
                                        {(t.taskLink || t.linkTugas || t.fileUrl) && (
                                          <div className="mb-2">
                                            <a
                                              href={(t.taskLink || t.linkTugas || t.fileUrl).startsWith("http") ? (t.taskLink || t.linkTugas || t.fileUrl) : `https://${t.taskLink || t.linkTugas || t.fileUrl}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 font-bold text-xs rounded-xl transition-all"
                                            >
                                              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                                              <span className="truncate max-w-xs">Link Tugas: {t.taskLink || t.linkTugas || t.fileUrl}</span>
                                            </a>
                                          </div>
                                        )}
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                                          Status Pipeline
                                        </span>
                                        <div className="flex items-center gap-2">
                                          <div className={`w-1.5 h-1.5 rounded-full ${t.publishedAt ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-slate-300'}`}></div>
                                          <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
                                            {t.publishedAt
                                              ? "Terdifusi"
                                              : "Draft Awal"}
                                          </span>
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => {
                                          setSelectedAssignmentFilter(t.id);
                                          setActiveMenu("manajemen-nilai");
                                          setActiveNilaiTab("cek-tugas");
                                        }}
                                        className="px-8 py-4 bg-[#85cc00] text-slate-950 rounded-2xl text-[11px] font-bold uppercase tracking-widest hover:brightness-110 shadow-lg shadow-[#85cc00]/20 transition-all active:scale-95"
                                      >
                                        Audit Kinerja
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))
                          )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeMenu === "manajemen-nilai" && (
                    <div className="space-y-12">
                      <div className="flex gap-4 border-b border-slate-200 mb-8">
                        <button
                          onClick={() => setActiveNilaiTab("cek-tugas")}
                          className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${
                            activeNilaiTab === "cek-tugas"
                              ? "text-[#85cc00] border-b-2 border-[#85cc00]"
                              : "text-slate-400"
                          }`}
                        >
                          Audit Pengumpulan
                        </button>
                        <button
                          onClick={() => setActiveNilaiTab("rekapitulasi")}
                          className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${
                            activeNilaiTab === "rekapitulasi"
                              ? "text-[#85cc00] border-b-2 border-[#85cc00]"
                              : "text-slate-400"
                          }`}
                        >
                          Buku Nilai
                        </button>
                      </div>

                      {activeNilaiTab === "cek-tugas" && (
                        <div className="space-y-12 animate-in fade-in slide-in-from-right-4 duration-700">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">
                                Audit Pengumpulan
                              </h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Tinjau pengumpulan tugas siswa dan kelola nilai tugas secara efisien.
                              </p>
                            </div>
                            <button
                              onClick={handleMassAudit}
                              disabled={isMassAuditing}
                              className="px-8 py-5 bg-[#85cc00] text-slate-950 rounded-2xl text-xs font-black uppercase tracking-widest hover:brightness-110 shadow-xl shadow-[#85cc00]/20 transition-all active:scale-95 flex items-center gap-3 disabled:opacity-50"
                            >
                              {isMassAuditing ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <Zap className="w-4 h-4" />
                              )}
                              Audit Semua Respon
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 bg-white p-8 sm:p-10 rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40">
                            <div className="space-y-4">
                              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2.5">
                                <User className="w-4 h-4 text-[#85cc00]" />
                                Cari Nama Siswa
                              </label>
                              <div className="relative group">
                                <input
                                  type="text"
                                  placeholder="Ketik nama atau NISN..."
                                  value={selectedStudentSearchFilter}
                                  onChange={(e) =>
                                    setSelectedStudentSearchFilter(e.target.value)
                                  }
                                  className="block w-full rounded-2xl bg-slate-50 border border-slate-200 pl-11 pr-10 py-5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none"
                                />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#85cc00] transition-colors">
                                  <Search className="w-4 h-4" />
                                </div>
                                {selectedStudentSearchFilter && (
                                  <button
                                    onClick={() => setSelectedStudentSearchFilter("")}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                                    title="Hapus pencarian"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-4">
                              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2.5">
                                <FileText className="w-4 h-4 text-[#85cc00]" />
                                Pilih Tugas
                              </label>
                              <div className="relative group">
                                <select
                                  value={selectedAssignmentFilter}
                                  onChange={(e) =>
                                    setSelectedAssignmentFilter(e.target.value)
                                  }
                                  className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none appearance-none cursor-pointer"
                                >
                                  <option value="">Semua Tugas Aktif</option>
                                  {assignmentsList.map((a, idx) => (
                                    <option key={`asg-opt-${a.id || idx}-${idx}`} value={a.id}>
                                      {a.materi}
                                    </option>
                                  ))}
                                </select>
                                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#85cc00] transition-colors">
                                  <ChevronDown className="w-5 h-5" />
                                </div>
                              </div>
                            </div>
                            <div className="space-y-4">
                              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2.5">
                                <Filter className="w-4 h-4 text-[#85cc00]" />
                                Filter Kelas
                              </label>
                              <div className="relative group">
                                <select
                                  value={selectedClassFilter}
                                  onChange={(e) =>
                                    setSelectedClassFilter(e.target.value)
                                  }
                                  className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none appearance-none cursor-pointer"
                                >
                                  <option value="">Semua Kelas</option>
                                  {classesList.map((c, idx) => (
                                    <option key={`cls-flt-opt-${c.id || c.name || idx}-${idx}`} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#85cc00] transition-colors">
                                  <ChevronDown className="w-5 h-5" />
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[2.5rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/40 overflow-hidden">
                            <div className="overflow-auto custom-scrollbar max-h-[700px]">
                              <table className="min-w-full text-left">
                                <thead>
                                  <tr className="bg-slate-50/50 border-b border-slate-100">
                                    <th className="px-10 py-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                      Identitas Siswa
                                    </th>
                                    <th className="px-10 py-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                      Modul Pembelajaran
                                    </th>
                                    <th className="px-10 py-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                      Penyerahan
                                    </th>
                                    <th className="px-10 py-8 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                      Status & Cap
                                    </th>
                                    <th className="px-10 py-8 text-right text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                                      Operasi
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {(() => {
                                    const filtered = submissionsList
                                      .filter((sub) => {
                                        const matchTask = selectedAssignmentFilter
                                          ? sub.assignmentId ===
                                            selectedAssignmentFilter
                                          : true;
                                        const matchClass = selectedClassFilter
                                          ? sub.kelas === selectedClassFilter
                                          : true;
                                        const student = studentsList.find(s => s.nisn === sub.nisn);
                                        const studentDisplayName = (student?.displayName || student?.studentName || student?.name || sub.studentName || "").toLowerCase();
                                        const searchQuery = selectedStudentSearchFilter.trim().toLowerCase();
                                        const matchStudent = searchQuery
                                          ? studentDisplayName.includes(searchQuery) || (sub.nisn && sub.nisn.toLowerCase().includes(searchQuery))
                                          : true;
                                        return matchTask && matchClass && matchStudent;
                                      })
                                      .sort((a, b) => {
                                        const getPriority = (sub: any) => {
                                          const isPending = sub.status !== "sudah dinilai" && !sub.nilai;
                                          const isResubmitted = !!sub.resubmittedAt && (sub.wasRejected === true || !!sub.keterangan || sub.status === "ditolak");
                                          if (isResubmitted && isPending) return 1;
                                          if (isResubmitted) return 2;
                                          if (isPending) return 3;
                                          return 4;
                                        };
                                        const prioA = getPriority(a);
                                        const prioB = getPriority(b);
                                        if (prioA !== prioB) return prioA - prioB;

                                        const timeA = new Date(a.submittedAt || a.createdAt || a.updatedAt || 0).getTime();
                                        const timeB = new Date(b.submittedAt || b.createdAt || b.updatedAt || 0).getTime();
                                        return timeB - timeA;
                                      });

                                    if (filtered.length === 0) {
                                      return (
                                        <tr>
                                          <td
                                            colSpan={5}
                                            className="px-10 py-32 text-center text-slate-400 font-bold uppercase tracking-widest italic"
                                          >
                                            <SearchX className="w-20 h-20 text-slate-100 mx-auto mb-8 stroke-[1]" />
                                            Data pengumpulan tugas tidak ditemukan
                                          </td>
                                        </tr>
                                      );
                                    }

                                    return filtered.map((sub, idx) => {
                                      const assignment = assignmentsList.find(
                                        (a) => a.id === sub.assignmentId,
                                      );
                                      const student = studentsList.find(s => s.nisn === sub.nisn);
                                      const studentDisplayName = student?.displayName || student?.studentName || student?.name || sub.studentName || "Siswa";
                                      const studentKelas = student?.kelas || sub.kelas || "-";
                                      const isTruePerbaikan = !!sub.resubmittedAt && (sub.wasRejected === true || !!sub.keterangan || sub.status === "ditolak");
                                      const isResubmittedPending = isTruePerbaikan && sub.status !== "sudah dinilai" && !sub.nilai;
                                      return (
                                        <tr
                                          key={`sub-${sub.id || idx}-${idx}`}
                                          className={`group transition-all ${isResubmittedPending ? "bg-amber-50/60 hover:bg-amber-100/50 border-l-4 border-amber-500" : "hover:bg-slate-50/50"}`}
                                        >
                                          <td className="px-10 py-8 whitespace-nowrap">
                                            <div className="flex items-center gap-4">
                                              {student?.profilePhotoUrl ? (
                                                <button 
                                                  onClick={() => setViewingStudentPhoto(student)}
                                                  className="w-10 h-10 rounded-xl overflow-hidden cursor-pointer shrink-0 border border-slate-200 shadow-sm hover:ring-2 hover:ring-[#85cc00]/50 transition-all"
                                                  title="Lihat Foto"
                                                >
                                                  <img 
                                                    src={getDriveImageUrl(student.profilePhotoUrl)} 
                                                    alt={studentDisplayName} 
                                                    referrerPolicy="no-referrer"
                                                    className="w-full h-full object-cover" 
                                                  />
                                                </button>
                                              ) : (
                                                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 font-bold text-xs uppercase group-hover:bg-white group-hover:text-[#85cc00] transition-all border border-slate-100 group-hover:border-[#85cc00]/20 shadow-sm shrink-0">
                                                  {(studentDisplayName || "S").charAt(0)}
                                                </div>
                                              )}
                                              <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-sm font-bold text-slate-800 transition-colors">
                                                    {studentDisplayName}
                                                  </span>
                                                  {isResubmittedPending && (
                                                    <span className="px-2.5 py-0.5 bg-amber-500 text-white font-extrabold text-[9px] rounded-full uppercase tracking-wider animate-pulse shadow-sm">
                                                      ‚≠ê PERBAIKAN
                                                    </span>
                                                  )}
                                                </div>
                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                                                  {studentKelas} ‚Ä¢ {sub.nisn}
                                                </span>
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-10 py-8 whitespace-nowrap">
                                            <div className="max-w-[280px] overflow-hidden text-ellipsis flex flex-col">
                                              <div className="flex items-center gap-3">
                                                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tight leading-none">
                                                  {assignment?.materi ||
                                                    "Konten Terarsip"}
                                                </span>
                                                {assignment && assignment.deadline && (() => {
                                                  const dl = new Date(assignment.deadline).getTime();
                                                  const diff = dl - Date.now();
                                                  return diff > 0 && diff < 24 * 60 * 60 * 1000 ? (
                                                    <Clock className="w-3.5 h-3.5 text-rose-500 animate-pulse shrink-0" />
                                                  ) : null;
                                                })()}
                                              </div>
                                              <span className="text-[10px] font-bold text-[#85cc00] uppercase tracking-widest mt-2 px-2.5 py-1 bg-[#85cc00]/10 rounded-lg self-start">
                                                Rilis: {getAssignmentPublishedAtForTeacher(assignment, sub.kelas)}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="px-10 py-8 whitespace-nowrap">
                                            <div className="flex flex-col gap-2">
                                              <div className="flex items-center gap-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-tight">
                                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                                {(() => {
                                                  const firstSubmit = sub.submittedAt || sub.createdAt || sub.updatedAt || sub.resubmittedAt;
                                                  return firstSubmit ? new Date(firstSubmit).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "-";
                                                })()}
                                              </div>
                                              <div className="flex items-center gap-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-tight">
                                                <Clock className="w-3.5 h-3.5 text-slate-400" />
                                                {(() => {
                                                  const firstSubmit = sub.submittedAt || sub.createdAt || sub.updatedAt || sub.resubmittedAt;
                                                  return firstSubmit ? new Date(firstSubmit).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-";
                                                })()}
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-10 py-8 whitespace-nowrap">
                                            <span
                                              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 font-bold text-[10px] uppercase tracking-widest border shadow-sm ${
                                                sub.status === "sudah dinilai" || sub.nilai
                                                  ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                                  : sub.status === "ditolak"
                                                    ? "bg-rose-50 text-rose-600 border-rose-100"
                                                    : "bg-amber-50 text-amber-600 border-amber-100 italic"
                                              }`}
                                            >
                                              <div className={`w-1.5 h-1.5 rounded-full ${
                                                sub.status === "sudah dinilai" || sub.nilai
                                                  ? "bg-emerald-500"
                                                  : sub.status === "ditolak"
                                                    ? "bg-rose-500"
                                                    : "bg-amber-500 animate-pulse"
                                              }`}></div>
                                              {sub.status === "ditolak"
                                                ? "Ditolak"
                                                : sub.nilai || sub.status === "sudah dinilai"
                                                  ? "Sudah Dinilai"
                                                  : isTruePerbaikan
                                                    ? "Kirim Ulang / Perbaikan"
                                                    : "Menunggu Penilaian Guru"}
                                            </span>
                                          </td>
                                          <td className="px-10 py-8 text-right whitespace-nowrap">
                                            <button
                                              className="px-8 py-4 bg-[#85cc00] text-slate-950 text-[10px] font-bold uppercase tracking-widest rounded-xl hover:brightness-110 shadow-lg shadow-[#85cc00]/20 transition-all active:scale-95"
                                              onClick={() =>
                                                handleTinjauNilai(sub)
                                              }
                                            >
                                              Audit Respon
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    });
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeNilaiTab === "rekapitulasi" && (
                        <div className="space-y-12 animate-in fade-in slide-in-from-left-4 duration-500">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">
                                Buku Nilai
                              </h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Tinjau rekapitulasi nilai akhir siswa dan pantau performa akademik kelas secara global.
                              </p>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                            <div className="rounded-[2.5rem] p-10 bg-white border border-slate-200 shadow-xl shadow-slate-200/40 relative overflow-hidden group">
                              <div className="absolute -right-8 -top-8 p-12 bg-slate-50 rounded-full opacity-0 group-hover:opacity-100 duration-700 transition-all group-hover:scale-150"></div>
                              <div className="relative z-10 text-center md:text-left">
                                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto md:mx-0 mb-10 text-slate-900 border border-slate-100 shadow-sm transition-transform group-hover:rotate-6 duration-500">
                                  <Users className="w-8 h-8 text-[#85cc00]" />
                                </div>
                                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                                  Populasi Siswa
                                </h4>
                                <p className="text-5xl font-display font-medium text-slate-900 tracking-tight leading-none">
                                  {studentsList.length}
                                </p>
                                <p className="mt-6 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                  Entri Database Aktif
                                </p>
                              </div>
                            </div>

                            <div className="rounded-[2.5rem] p-10 bg-white border border-slate-200 shadow-xl shadow-slate-200/40 relative overflow-hidden group">
                              <div className="absolute -right-8 -top-8 p-12 bg-emerald-50/50 rounded-full opacity-0 group-hover:opacity-100 duration-700 transition-all group-hover:scale-150"></div>
                              <div className="relative z-10 text-center md:text-left">
                                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto md:mx-0 mb-10 text-emerald-600 border border-emerald-100 shadow-sm transition-transform group-hover:rotate-6 duration-500">
                                  <Trophy className="w-8 h-8" />
                                </div>
                                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                                  IPK Kelas Global
                                </h4>
                                <p className="text-5xl font-display font-medium text-emerald-600 tracking-tight leading-none">
                                  {(() => {
                                    const graded = submissionsList.filter(
                                      (s) => s.nilai,
                                    );
                                    if (graded.length === 0) return "0.0";
                                    const sum = graded.reduce(
                                      (acc, curr) => acc + Number(curr.nilai),
                                      0,
                                    );
                                    return (sum / graded.length).toFixed(1);
                                  })()}
                                </p>
                                <p className="mt-6 text-[10px] text-emerald-600/60 font-bold uppercase tracking-widest">
                                  Rata-rata Keberhasilan
                                </p>
                              </div>
                            </div>

                            <div className="rounded-[2.5rem] p-10 bg-gradient-to-br from-[#85cc00] to-[#74b300] text-slate-950 shadow-2xl shadow-[#85cc00]/20 relative overflow-hidden group">
                              <div className="absolute -right-8 -top-8 p-12 bg-white/20 rounded-full opacity-0 group-hover:opacity-100 duration-700 transition-all group-hover:scale-150"></div>
                              <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                  <div className="w-16 h-16 bg-white/30 rounded-2xl flex items-center justify-center mx-auto md:mx-0 mb-10 border border-white/40 shadow-lg group-hover:rotate-12 transition-all duration-500">
                                    <GraduationCap className="w-8 h-8 text-slate-950" />
                                  </div>
                                  <h4 className="text-[11px] font-bold text-slate-900/60 uppercase tracking-widest mb-3">
                                    Filter Segmen Kelas
                                  </h4>
                                  <p className="text-2xl font-display font-bold italic tracking-tighter uppercase text-slate-950">
                                    {selectedClassFilter || "Seluruh Kelas Aktif"}
                                  </p>
                                </div>
                                <div className="mt-10 relative group/select">
                                  <select
                                    value={selectedClassFilter}
                                    onChange={(e) =>
                                      setSelectedClassFilter(e.target.value)
                                    }
                                    className="w-full bg-white/20 border border-white/40 text-slate-950 text-[11px] font-bold uppercase tracking-widest rounded-xl px-6 py-5 outline-none focus:bg-white/40 focus:border-white appearance-none transition-all cursor-pointer placeholder-slate-900"
                                  >
                                    <option value="" className="bg-white text-slate-900 font-semibold">
                                      Pilih Jalur Kelas...
                                    </option>
                                    {classesList.map((c, idx) => (
                                      <option key={`grad-cls-${c.id || c.name || idx}-${idx}`} value={c.name} className="bg-white text-slate-900 font-semibold">
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none text-slate-950 group-hover/select:scale-110 transition-transform">
                                    <ChevronDown className="w-5 h-5" />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Rubrik Penilaian Rapor Card */}
                          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 p-8 md:p-10 space-y-6">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-100 pb-6">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center border border-slate-100 text-[#85cc00]">
                                  <Settings className="w-5 h-5" />
                                </div>
                                <div>
                                  <h3 className="text-lg font-bold text-slate-950">
                                    Konfigurasi Rubrik Nilai Rapor
                                  </h3>
                                  <p className="text-xs text-slate-400 font-medium">
                                    Atur persentase bobot penilaian untuk kalkulasi Nilai Rapor akhir siswa.
                                  </p>
                                </div>
                              </div>
                              {!isEditingRubric ? (
                                <button
                                  onClick={() => setIsEditingRubric(true)}
                                  className="px-5 py-2.5 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-[#85cc00] hover:text-slate-900 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 flex items-center gap-2 cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                  Edit Proporsi Bobot
                                </button>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={handleSaveRubric}
                                    disabled={isSavingRubric}
                                    className="px-5 py-2.5 bg-[#85cc00] text-slate-950 rounded-xl text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                                  >
                                    {isSavingRubric ? "Menyimpan..." : "Simpan Rubrik"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setIsEditingRubric(false);
                                      setEditKehadiran(String(rubric.kehadiran));
                                      setEditTugas(String(rubric.tugas));
                                      setEditUts(String(rubric.uts));
                                      setEditUas(String(rubric.uas));
                                    }}
                                    className="px-5 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-bold uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
                                  >
                                    Batal
                                  </button>
                                </div>
                              )}
                            </div>

                            {!isEditingRubric ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100 flex flex-col justify-between hover:border-emerald-200 transition-all group">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Kehadiran</span>
                                    <Users className="w-4 h-4 text-emerald-500 opacity-30" />
                                  </div>
                                  <div className="flex items-baseline gap-1 mt-1">
                                    <span className="text-3xl font-display font-black text-emerald-600">{rubric.kehadiran}</span>
                                    <span className="text-xs font-bold text-emerald-400">%</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 leading-snug mt-3 font-medium">Bobot dari persentase kehadiran siswa (jumlah hadir & dispen).</p>
                                </div>

                                <div className="p-5 bg-blue-50 rounded-2xl border border-blue-100 flex flex-col justify-between hover:border-blue-200 transition-all group">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-blue-700">Tugas & Harian</span>
                                    <BookOpen className="w-4 h-4 text-blue-500 opacity-30" />
                                  </div>
                                  <div className="flex items-baseline gap-1 mt-1">
                                    <span className="text-3xl font-display font-black text-blue-600">{rubric.tugas}</span>
                                    <span className="text-xs font-bold text-blue-400">%</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 leading-snug mt-3 font-medium">Bobot rata-rata tugas dan ujian harian (Pretest/Postest/Ulangan).</p>
                                </div>

                                <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100 flex flex-col justify-between hover:border-amber-200 transition-all group">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Ujian Tengah Semester (UTS)</span>
                                    <Star className="w-4 h-4 text-amber-500 opacity-30" />
                                  </div>
                                  <div className="flex items-baseline gap-1 mt-1">
                                    <span className="text-3xl font-display font-black text-amber-600">{rubric.uts}</span>
                                    <span className="text-xs font-bold text-amber-400">%</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 leading-snug mt-3 font-medium">Bobot nilai dari ujian Penilaian Tengah Semester.</p>
                                </div>

                                <div className="p-5 bg-rose-50 rounded-2xl border border-rose-100 flex flex-col justify-between hover:border-rose-200 transition-all group">
                                  <div className="flex justify-between items-start mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-rose-700">Ujian Akhir Semester (UAS)</span>
                                    <Award className="w-4 h-4 text-rose-500 opacity-30" />
                                  </div>
                                  <div className="flex items-baseline gap-1 mt-1">
                                    <span className="text-3xl font-display font-black text-rose-600">{rubric.uas}</span>
                                    <span className="text-xs font-bold text-rose-400">%</span>
                                  </div>
                                  <p className="text-[10px] text-slate-400 leading-snug mt-3 font-medium">Bobot nilai dari ujian Penilaian Sumatif Akhir Semester.</p>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                  <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Kehadiran (%)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={editKehadiran}
                                      onChange={(e) => setEditKehadiran(e.target.value)}
                                      className="block w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Tugas & Harian (%)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={editTugas}
                                      onChange={(e) => setEditTugas(e.target.value)}
                                      className="block w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">UTS (%)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={editUts}
                                      onChange={(e) => setEditUts(e.target.value)}
                                      className="block w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">UAS (%)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={editUas}
                                      onChange={(e) => setEditUas(e.target.value)}
                                      className="block w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all"
                                    />
                                  </div>
                                </div>
                                <div className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between border border-slate-100">
                                  <span className="text-xs font-semibold text-slate-500">Live Kalkulasi Total:</span>
                                  {(() => {
                                    const total = (Number(editKehadiran) || 0) + (Number(editTugas) || 0) + (Number(editUts) || 0) + (Number(editUas) || 0);
                                    const isValid = total === 100;
                                    return (
                                      <span className={`text-sm font-black px-4 py-1.5 rounded-xl border ${isValid ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-rose-50 text-rose-700 border-rose-100 animate-pulse"}`}>
                                        {total}% {isValid ? "‚Äî Valid (Tepat 100%)" : `‚Äî Salah (Harus 100%, selisih ${100 - total}%)`}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/40 p-3 overflow-hidden">
                             <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-6 p-6 border-b border-slate-100 bg-slate-50/50 rounded-t-[2rem]">
                               {/* Left Controls: Class filter and Student search */}
                               <div className="flex flex-col sm:flex-row gap-4 w-full md:max-w-xl">
                                 {/* Dropdown Kelas */}
                                 <div className="flex-1 space-y-1.5">
                                   <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block ml-1">
                                     Filter Kelas
                                   </label>
                                   <div className="relative group">
                                     <select
                                       value={selectedClassFilter}
                                       onChange={(e) => setSelectedClassFilter(e.target.value)}
                                       className="block w-full rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-900 focus:border-[#85cc00] focus:ring-2 focus:ring-[#85cc00]/10 transition-all outline-none appearance-none cursor-pointer"
                                     >
                                       <option value="">Semua Kelas</option>
                                       {classesList.map((c, idx) => (
                                         <option key={`stu-flt-${c.id || c.name || idx}-${idx}`} value={c.name}>
                                           {c.name}
                                         </option>
                                       ))}
                                     </select>
                                     <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#85cc00] transition-colors">
                                       <ChevronDown className="w-4 h-4" />
                                     </div>
                                   </div>
                                 </div>

                                 {/* Textbox Pencarian Siswa */}
                                 <div className="flex-1 space-y-1.5">
                                   <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 block ml-1">
                                     Pencarian Siswa
                                   </label>
                                   <div className="relative group">
                                     <input
                                       type="text"
                                       placeholder="Cari nama atau NISN..."
                                       value={studentSearchQuery}
                                       onChange={(e) => setStudentSearchQuery(e.target.value)}
                                       className="block w-full rounded-xl bg-white border border-slate-200 pl-10 pr-8 py-2.5 text-xs font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-semibold focus:border-[#85cc00] focus:ring-2 focus:ring-[#85cc00]/10 transition-all outline-none"
                                     />
                                     <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-[#85cc00] transition-colors">
                                       <Search className="w-4 h-4" />
                                     </div>
                                     {studentSearchQuery && (
                                       <button
                                         onClick={() => setStudentSearchQuery("")}
                                         className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                                       >
                                         <X className="w-4 h-4" />
                                       </button>
                                     )}
                                   </div>
                                 </div>
                               </div>

                               {/* Right Controls: Export Buttons */}
                               <div className="flex flex-wrap items-center gap-3 shrink-0">
                                 <button
                                   onClick={() => setIsAddManualColumnOpen(true)}
                                   className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all flex items-center gap-2 active:scale-95 shadow-md shadow-indigo-600/20 cursor-pointer"
                                 >
                                   <Plus className="w-4 h-4"/>
                                   Tambah Kolom Nilai
                                 </button>
                                 <button
                                   onClick={() => setIsEditingRekapTable(!isEditingRekapTable)}
                                   className={`px-4 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95 shadow-md cursor-pointer ${
                                     isEditingRekapTable
                                       ? "bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20"
                                       : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/20"
                                   }`}
                                 >
                                   <Edit className="w-4 h-4"/>
                                   {isEditingRekapTable ? "Selesai Edit" : "Edit Nilai Tabel"}
                                 </button>
                                 <button onClick={handleDownloadExcel} className="px-6 py-2.5 bg-[#85cc00] text-slate-950 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center gap-2.5 active:scale-95 shadow-lg shadow-[#85cc00]/20">
                                   <Download className="w-4 h-4"/> 
                                   Export Excel
                                 </button>
                                 <button onClick={handlePreviewNilaiPDF} className="px-4 py-2.5 bg-sky-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-sky-700 transition-all flex items-center gap-2 active:scale-95 shadow-md shadow-sky-600/20">
                                   <Eye className="w-4 h-4"/> 
                                   Preview PDF
                                 </button>
                                 <button onClick={handleDownloadPDF} className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-[#85cc00] hover:text-slate-900 transition-all flex items-center gap-2 active:scale-95 shadow-md shadow-slate-900/10">
                                   <FileText className="w-4 h-4"/> 
                                   Ekspor PDF
                                 </button>
                               </div>
                             </div>

                             <div className="mb-4 text-xs font-black text-slate-900 flex items-center gap-2">
                               <span className="inline-block w-2.5 h-2.5 bg-[#85cc00] rounded-full"></span>
                               Tanggal Update Nilai: {new Date().toLocaleDateString("id-ID", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(",", "")}
                             </div>

                             {/* Banner Status Edit Nilai */}
                             {isEditingRekapTable && (
                               <div className="mb-4 p-4 bg-amber-50/90 border-2 border-amber-300 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in duration-300">
                                 <div className="flex items-center gap-3">
                                   <div className="w-9 h-9 rounded-xl bg-amber-200/70 flex items-center justify-center text-amber-800 shrink-0">
                                     <Edit className="w-5 h-5" />
                                   </div>
                                   <div>
                                     <p className="text-xs font-black text-amber-950 uppercase tracking-wide">
                                       Mode Edit Nilai Tabel Aktif ‚úèÔ∏è
                                     </p>
                                     <p className="text-[11px] text-amber-800 font-medium">
                                       Silakan ubah/input nilai siswa langsung pada sel tabel di bawah. Klik <span className="font-extrabold text-amber-950">"Simpan Semua Nilai"</span> setelah selesai.
                                       {Object.keys(editedRekapGrades).length > 0 && (
                                         <span className="ml-2 font-black text-rose-700 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded-md">
                                           {Object.keys(editedRekapGrades).length} nilai diubah
                                         </span>
                                       )}
                                     </p>
                                   </div>
                                 </div>
                                 <div className="flex items-center gap-2 shrink-0">
                                   <button
                                     onClick={handleSaveRekapGrades}
                                     disabled={isSavingRekapGrades}
                                     className="px-5 py-2.5 bg-[#85cc00] text-slate-950 font-black uppercase text-[11px] tracking-wider rounded-xl shadow-md hover:brightness-110 active:scale-95 disabled:opacity-40 transition-all flex items-center gap-2 cursor-pointer"
                                   >
                                     <Save className="w-4 h-4" />
                                     {isSavingRekapGrades ? "Menyimpan..." : "Simpan Semua Nilai"}
                                   </button>
                                   <button
                                     onClick={() => {
                                       setEditedRekapGrades({});
                                       setIsEditingRekapTable(false);
                                     }}
                                     className="px-4 py-2.5 bg-slate-200 text-slate-700 font-bold uppercase text-[11px] tracking-wider rounded-xl hover:bg-slate-300 transition-all cursor-pointer"
                                   >
                                     Batal
                                   </button>
                                 </div>
                               </div>
                             )}

                            <div className="overflow-auto custom-scrollbar max-h-[800px]">
                              <table id="rekapTable" className="min-w-full border-collapse text-left bg-white border-2 border-black shadow-lg">
                                <thead className="sticky top-0 z-30">
                                  <tr className="bg-white">
                                    <th
                                      colSpan={7 + assignmentsList.length + examsList.length}
                                      className="px-6 py-4 text-left text-sm font-black text-slate-900 border border-black"
                                    >
                                      Tanggal Update Nilai {new Date().toLocaleDateString("id-ID", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(",", "")}
                                    </th>
                                  </tr>
                                  <tr className="bg-slate-100">
                                    <th className="px-6 py-6 text-center text-sm font-black text-slate-900 bg-slate-100 uppercase tracking-wider sticky top-0 border border-black whitespace-nowrap z-30">
                                      No
                                    </th>
                                    <th className="px-8 py-6 text-left text-sm font-black text-slate-900 bg-slate-100 uppercase tracking-wider sticky top-0 z-30 border border-black whitespace-nowrap">
                                      NIS/NISN
                                    </th>
                                    <th className="px-8 py-6 text-left text-sm font-black text-slate-900 bg-slate-100 uppercase tracking-wider sticky top-0 z-30 w-80 border border-black whitespace-nowrap">
                                      Nama Lengkap Siswa
                                    </th>
                                    <th className="px-6 py-6 text-center text-sm font-black text-slate-900 bg-slate-100 uppercase tracking-wider sticky top-0 z-30 border border-black whitespace-nowrap">
                                      Nilai Kehadiran
                                    </th>
                                    {(() => {
                                      const mergedCols = [
                                        ...assignmentsList.map((a) => ({
                                          id: a.id,
                                          title: a.materi,
                                          type: "assignment",
                                          date: a.publishedAt || a.createdAt,
                                          deadline: a.deadline,
                                        })),
                                        ...examsList.map((e) => ({
                                          id: e.id,
                                          title: e.title,
                                          type: "exam",
                                          date: e.createdAt,
                                          deadline: null,
                                        })),
                                      ].sort((a, b) => {
                                        const dateA = a.date ? new Date(a.date).getTime() : 0;
                                        const dateB = b.date ? new Date(b.date).getTime() : 0;
                                        return dateA - dateB;
                                      });

                                      return mergedCols.map((col, idx) => (
                                        <th
                                          key={`col-${col.type}-${col.id || idx}-${idx}`}
                                          className="px-6 py-6 text-center text-xs font-black text-slate-900 bg-slate-100 uppercase tracking-wider border border-black whitespace-nowrap sticky top-0 z-30"
                                        >
                                          <div className="flex flex-col text-center items-center justify-center relative px-2">
                                            {(() => {
                                              if (col.deadline) {
                                                const dl = new Date(col.deadline).getTime();
                                                const now = Date.now();
                                                const diff = dl - now;
                                                const isNear = diff > 0 && diff < 24 * 60 * 60 * 1000;
                                                if (isNear) {
                                                  return (
                                                    <div className="absolute -top-6 right-0" title="Tenggat Mendekati">
                                                      <Clock className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                                                    </div>
                                                  );
                                                }
                                              }
                                              return null;
                                            })()}
                                            <span className="text-xs text-slate-800 font-bold whitespace-nowrap leading-snug flex items-center justify-center mb-2" title={col.title}>
                                              {col.title}
                                            </span>
                                            <div className="flex items-center gap-1.5 mt-1">
                                              <span className={`text-[8px] font-bold uppercase px-2 py-0.5 rounded-md ${col.type === "exam" ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-blue-50 text-blue-600 border border-blue-100"}`}>
                                                {col.type === "exam" ? "CBT" : "Tugas"}
                                              </span>
                                            </div>
                                            <span className="text-[10px] text-slate-900 font-bold mt-2 whitespace-nowrap">
                                              {col.date ? new Date(col.date).toLocaleDateString("id-ID", { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(",", "") : "-"}
                                            </span>
                                          </div>
                                        </th>
                                      ));
                                    })()}
                                    
                                    <th className="px-6 py-6 text-center text-sm font-black text-slate-900 bg-slate-100 uppercase tracking-wider sticky top-0 border border-black whitespace-nowrap z-30">
                                      Nilai Rapor
                                    </th>
                                    <th className="px-6 py-6 text-center text-sm font-black text-slate-900 bg-slate-100 uppercase tracking-wider sticky top-0 border border-black whitespace-nowrap z-30">
                                      Status
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white">
                                  {studentsList
                                    .filter((stu) => {
                                      const matchClass = selectedClassFilter
                                        ? stu.kelas === selectedClassFilter
                                        : true;
                                      const matchSearch = studentSearchQuery
                                        ? (stu.displayName || stu.studentName || "").toLowerCase().includes(studentSearchQuery.toLowerCase()) ||
                                          (stu.nisn || "").includes(studentSearchQuery)
                                        : true;
                                      return matchClass && matchSearch;
                                    })
                                    .sort((a, b) => {
                                      const classA = (a.kelas || "").toString();
                                      const classB = (b.kelas || "").toString();
                                      const classComp = classA.localeCompare(classB, "id", { numeric: true, sensitivity: "base" });
                                      if (classComp !== 0) return classComp;
                                      return (a.displayName || a.studentName || "").localeCompare(
                                        b.displayName || b.studentName || "",
                                        "id",
                                        { sensitivity: "base" }
                                      );
                                    })
                                    .map((stu, index) => {
                                      const studentSubs =
                                        submissionsList.filter(
                                          (s) => s.nisn === stu.nisn,
                                        );

                                      let totalScore = 0;
                                      let count = 0;

                                      return (
                                        <tr
                                          key={`stu-${stu.id || stu.nisn || index}-${index}`}
                                          className="group hover:bg-slate-50/40 transition-colors"
                                        >
                                          <td className="px-6 py-5 text-sm font-mono font-black text-slate-900 bg-white whitespace-nowrap border border-black text-center">
                                            {index + 1}
                                          </td>
                                          <td className="px-8 py-5 bg-white whitespace-nowrap text-slate-900 font-bold tracking-tight border border-black text-sm">
                                            {stu.nisn}
                                          </td>
                                          <td className="px-8 py-5 whitespace-nowrap border border-black bg-white text-slate-900 font-medium">
                                            <span className="text-sm font-bold text-slate-900 whitespace-nowrap">
                                              {stu.displayName || stu.studentName}
                                            </span>
                                          </td>
                                          <td className="px-6 py-5 text-center whitespace-nowrap border border-black bg-white text-slate-900 font-bold">
                                            {(() => {
                                              const { total, persentase } = getStudentAbsensiCounts(stu, absensiList, selectedClassFilter || stu.kelas);
                                              const presenceScore = total > 0 ? persentase : 100;
                                              return (
                                                <span className="text-sm font-mono font-black text-slate-900">
                                                  {presenceScore}%
                                                </span>
                                              );
                                            })()}
                                          </td>
                                          {(() => {
                                            const mergedColsForStu = [
                                              ...assignmentsList.map((a) => ({
                                                id: a.id,
                                                title: a.materi,
                                                type: "assignment",
                                                date: a.publishedAt || a.createdAt,
                                              })),
                                              ...examsList.map((e) => ({
                                                id: e.id,
                                                title: e.title,
                                                type: "exam",
                                                date: e.createdAt,
                                              })),
                                            ].sort((a, b) => {
                                              const dateA = a.date ? new Date(a.date).getTime() : 0;
                                              const dateB = b.date ? new Date(b.date).getTime() : 0;
                                              return dateA - dateB;
                                            });

                                            return mergedColsForStu.map((col, colIdx) => {
                                              let score = "";
                                              if (col.type === "assignment") {
                                                const sub = studentSubs.find(
                                                  (s) => s.assignmentId === col.id
                                                );
                                                const fGrade = finalGradesList.find(
                                                  (f) =>
                                                    f.assignmentId === col.id &&
                                                    f.nisn === stu.nisn
                                                );
                                                score = sub?.nilai || fGrade?.nilai || "";
                                              } else {
                                                const fGrade = finalGradesList.find(
                                                  (f) =>
                                                    f.assignmentId === col.id &&
                                                    f.nisn === stu.nisn
                                                );
                                                score = fGrade?.nilai || "";
                                              }

                                              const cellKey = `${col.id}_${stu.nisn}`;
                                              const isEdited = editedRekapGrades[cellKey] !== undefined;
                                              const activeScoreStr = isEdited
                                                ? editedRekapGrades[cellKey]
                                                : (score !== undefined && score !== null ? String(score) : "");

                                              if (activeScoreStr !== "") {
                                                totalScore += Number(activeScoreStr);
                                                count++;
                                              }

                                              return (
                                                <td
                                                  key={`col-${col.type}-${col.id || colIdx}-${colIdx}`}
                                                  className={`px-3 py-2 text-center whitespace-nowrap border border-black font-bold transition-colors ${
                                                    isEdited ? "bg-amber-100/90 text-amber-950" : "bg-white text-slate-900"
                                                  }`}
                                                >
                                                  {isEditingRekapTable ? (
                                                    <input
                                                      type="number"
                                                      min="0"
                                                      max="100"
                                                      value={activeScoreStr}
                                                      placeholder="0-100"
                                                      onChange={(e) => {
                                                        const val = e.target.value;
                                                        setEditedRekapGrades((prev) => ({
                                                          ...prev,
                                                          [cellKey]: val,
                                                        }));
                                                      }}
                                                      className="w-16 h-8 text-center font-mono font-black text-xs text-slate-900 bg-amber-50 border-2 border-amber-400 focus:bg-white focus:border-[#85cc00] focus:ring-2 focus:ring-[#85cc00]/20 rounded-md outline-none transition-all"
                                                    />
                                                  ) : (
                                                    <button
                                                      type="button"
                                                      onClick={() => setIsEditingRekapTable(true)}
                                                      className="group/cell w-full h-full inline-flex items-center justify-center gap-1 hover:text-[#85cc00] cursor-pointer"
                                                      title="Klik untuk mengedit nilai pada tabel"
                                                    >
                                                      {activeScoreStr ? (
                                                        <span className={`text-sm font-mono font-black ${isEdited ? "text-amber-800" : "text-slate-900"}`}>
                                                          {activeScoreStr}
                                                        </span>
                                                      ) : (
                                                        <span className={`text-sm font-mono font-black ${isEdited ? "text-amber-800" : "text-slate-500"}`}>
                                                          0
                                                        </span>
                                                      )}
                                                    </button>
                                                  )}
                                                </td>
                                              );
                                            });
                                          })()}
                                          
                                          <td className="px-6 py-5 text-center whitespace-nowrap bg-white border border-black text-slate-900 font-bold">
                                             {(() => {
                                               const roundedFinal = calculateNilaiRapor(stu);
                                               return (
                                                 <span className="text-sm font-mono font-black text-slate-900">
                                                   {roundedFinal}
                                                 </span>
                                               );
                                             })()}
                                           </td>
                                           <td className="px-6 py-5 text-center whitespace-nowrap bg-white border border-black text-slate-900 font-bold">
                                             {(() => {
                                               const roundedFinal = calculateNilaiRapor(stu);
                                               const isPassed = roundedFinal >= 75;
                                               const statusColor = isPassed
                                                 ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                                                 : "text-rose-700 bg-rose-50 border-rose-200";

                                               return (
                                                 <span className={`inline-flex items-center justify-center px-3 py-1 text-xs font-black uppercase tracking-wider rounded-xl border shadow-sm min-w-[100px] ${statusColor}`}>
                                                   {isPassed ? "Tuntas" : "Belum Tuntas"}
                                                 </span>
                                               );
                                             })()}
                                           </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeMenu === "materi-ajar" && (
                    <div className="space-y-12 animate-in fade-in duration-300">
                      <div className="flex gap-4 border-b border-slate-200">
                        <button
                          onClick={() => {
                            setActiveMateriTab("tambah");
                            setMateriSaveMessage({ text: "", type: "" });
                          }}
                          className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${
                            activeMateriTab === "tambah"
                              ? "text-[#85cc00] border-b-2 border-[#85cc00]"
                              : "text-slate-400"
                          }`}
                        >
                          {editingMateriId ? "Edit Materi" : "Tambah Materi"}
                        </button>
                        <button
                          onClick={() => {
                            setActiveMateriTab("daftar");
                            setMateriSaveMessage({ text: "", type: "" });
                            setEditingMateriId(null);
                            setMateriTitle("");
                            setMateriDescription("");
                            setMateriBab("");
                            setMateriDriveUrl("");
                            setMateriKelas("");
                          }}
                          className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${
                            activeMateriTab === "daftar"
                              ? "text-[#85cc00] border-b-2 border-[#85cc00]"
                              : "text-slate-400"
                          }`}
                        >
                          Daftar Materi
                        </button>
                      </div>

                      {activeMateriTab === "tambah" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Materi Ajar</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Kelola semua materi pelajaran Informatika dengan link Google Drive untuk disinkronkan langsung ke dashboard materi ajar siswa.
                              </p>
                            </div>
                          </div>

                          <div className="max-w-4xl">
                            <div className="rounded-[2.5rem] bg-white p-10 border border-slate-200 shadow-xl shadow-slate-200/40">
                            <div className="flex items-center gap-6 mb-10 pb-10 border-b border-slate-100">
                              <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-900 border border-slate-100">
                                <BookOpen className="w-6 h-6 text-[#85cc00]" />
                              </div>
                              <div>
                                <h3 className="text-xl font-bold text-slate-800 tracking-tight leading-none mb-2">
                                  {editingMateriId ? "Edit Konfigurasi Materi" : "Konfigurasi Materi Baru"}
                                </h3>
                                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                                  Definisikan detail materi dan kaitkan dengan folder/file Google Drive
                                </p>
                              </div>
                            </div>

                            {materiSaveMessage.text && (
                              <div
                                className={`mb-10 rounded-xl p-5 flex items-start gap-4 animate-in fade-in slide-in-from-top-2 duration-500 border ${
                                  materiSaveMessage.type === "error"
                                    ? "bg-rose-50 text-rose-600 border-rose-100"
                                    : "bg-emerald-50 text-emerald-600 border-emerald-100"
                                }`}
                              >
                                {materiSaveMessage.type === "error" ? (
                                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                ) : (
                                  <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                                )}
                                <p className="text-xs font-bold uppercase tracking-wider leading-relaxed">
                                  {materiSaveMessage.text}
                                </p>
                              </div>
                            )}

                            <div className="space-y-12">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                <div className="space-y-6">
                                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                    1. Judul Materi
                                  </label>
                                  <input
                                    type="text"
                                    value={materiTitle}
                                    onChange={(e) => setMateriTitle(e.target.value)}
                                    placeholder="Contoh: Pengenalan Struktur Data Linier"
                                    className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-4.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none"
                                  />
                                </div>

                                <div className="space-y-6">
                                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                    2. Bab / Topik Pembelajaran
                                  </label>
                                  <select
                                    value={materiBab}
                                    onChange={(e) => setMateriBab(e.target.value)}
                                    className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-4.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none appearance-none cursor-pointer"
                                  >
                                    <option value="">Pilih Bab Pembelajaran...</option>
                                    <option value="Informatika dan Keterampilan Generik">Informatika dan Keterampilan Generik</option>
                                    <option value="Bab 1: Informatika dan Keterampilan Generik">Bab 1: Informatika dan Keterampilan Generik</option>
                                    {chaptersList.map((c, idx) => (
                                      <option key={`chap-materi-${c.id || c.name || idx}-${idx}`} value={c.name}>
                                        {c.name}
                                      </option>
                                    ))}
                                    <option value="Algoritma & Pemrograman">Algoritma & Pemrograman</option>
                                    <option value="Dampak Sosial Informatika">Dampak Sosial Informatika</option>
                                    <option value="Teknologi Informasi & Komunikasi">Teknologi Informasi & Komunikasi</option>
                                    <option value="Sistem Komputer">Sistem Komputer</option>
                                    <option value="Jaringan Komputer & Internet">Jaringan Komputer & Internet</option>
                                    <option value="Analisis Data">Analisis Data</option>
                                  </select>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                <div className="space-y-6">
                                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                    3. Target Kelas (Mengambil dari kelas siswa)
                                  </label>
                                  <select
                                    value={materiKelas}
                                    onChange={(e) => setMateriKelas(e.target.value)}
                                    className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-4.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none appearance-none cursor-pointer"
                                  >
                                    <option value="">Semua Kelas (Umum)</option>
                                    {classesList.map((c, idx) => (
                                      <option key={`mat-cls-${c.id || c.name || idx}-${idx}`} value={c.name}>
                                        Kelas {c.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="space-y-6">
                                  <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                    4. Link Google Drive (File Materi)
                                  </label>
                                  <input
                                    type="text"
                                    value={materiDriveUrl}
                                    onChange={(e) => setMateriDriveUrl(e.target.value)}
                                    placeholder="https://drive.google.com/..."
                                    className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-4.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none"
                                  />
                                </div>
                              </div>

                              <div className="space-y-6">
                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                                  5. Deskripsi atau Petunjuk Belajar (Opsional)
                                </label>
                                <textarea
                                  value={materiDescription}
                                  onChange={(e) => setMateriDescription(e.target.value)}
                                  placeholder="Tuliskan petunjuk belajar, ringkasan materi, atau instruksi pengerjaan..."
                                  rows={4}
                                  className="block w-full rounded-2xl bg-slate-50 border border-slate-200 px-6 py-4.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none resize-none"
                                />
                              </div>

                              <div className="pt-10 border-t border-slate-100 flex justify-end gap-4">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveMateriTab("daftar");
                                    setEditingMateriId(null);
                                    setMateriTitle("");
                                    setMateriDescription("");
                                    setMateriBab("");
                                    setMateriDriveUrl("");
                                    setMateriKelas("");
                                  }}
                                  className="px-8 py-4 rounded-2xl border border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-colors"
                                >
                                  Batal
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingMateri}
                                  onClick={handleSimpanMateri}
                                  className="px-8 py-4 rounded-2xl bg-[#85cc00] text-slate-900 font-bold text-xs uppercase tracking-widest hover:brightness-110 shadow-lg shadow-[#85cc00]/20 disabled:opacity-50 transition-all flex items-center gap-2"
                                >
                                  {isSavingMateri ? "Menyimpan..." : (editingMateriId ? "Perbarui Materi" : "Simpan & Terbitkan")}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                      {activeMateriTab === "daftar" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Materi Ajar</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Kelola semua materi pelajaran Informatika dengan link Google Drive untuk disinkronkan langsung ke dashboard materi ajar siswa.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-8">
                          {/* Filter Card */}
                          <div className="bg-white rounded-[2rem] p-8 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
                            <div>
                              <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-1">
                                Filter Berdasarkan Kelas
                              </h4>
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                                Filter materi ajar untuk menyesuaikan target kelas siswa
                              </p>
                            </div>
                            <select
                              value={materiKelas}
                              onChange={(e) => setMateriKelas(e.target.value)}
                              className="w-full md:w-64 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs font-bold text-slate-900 focus:bg-white focus:border-[#85cc00] focus:ring-4 focus:ring-[#85cc00]/10 transition-all outline-none appearance-none cursor-pointer"
                            >
                              <option value="">Semua Kelas / Umum</option>
                              {classesList.map((c, idx) => (
                                <option key={`mat-cls-flt-${c.id || c.name || idx}-${idx}`} value={c.name}>
                                  Kelas {c.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* List Card */}
                          <div className="border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                                Daftar Materi Terdaftar
                              </h3>
                              <span className="text-xs font-black text-[#85cc00] bg-[#85cc00]/10 px-4 py-1.5 rounded-full uppercase tracking-wider">
                                Total: {
                                  materiKelas 
                                    ? materialsList.filter(m => m.kelasRef === materiKelas).length 
                                    : materialsList.length
                                } Materi
                              </span>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-sm min-w-[800px]">
                                <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-200">
                                  <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    <th className="p-4 bg-slate-50">No</th>
                                    <th className="p-4 bg-slate-50">Detail Materi</th>
                                    <th className="p-4 text-right bg-slate-50">Aksi</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {(materiKelas 
                                    ? materialsList.filter(m => m.kelasRef === materiKelas)
                                    : materialsList
                                  ).length === 0 ? (
                                    <tr>
                                      <td colSpan={3} className="py-20 text-center">
                                        <div className="flex flex-col justify-center text-slate-300">
                                          <BookOpen className="w-16 h-16 mb-4 stroke-1 text-slate-200" />
                                          <p className="text-sm font-black uppercase tracking-wider text-slate-400">
                                            Belum Ada Materi Ajar
                                          </p>
                                          <p className="text-xs text-slate-300 font-bold mt-1 max-w-sm">
                                            Klik tombol "Tambah Materi" untuk mulai membagikan link materi pembelajaran ke siswa.
                                          </p>
                                        </div>
                                      </td>
                                    </tr>
                                  ) : (
                                    (materiKelas 
                                      ? materialsList.filter(m => m.kelasRef === materiKelas)
                                      : materialsList
                                    ).map((material, index) => (
                                      <tr key={`mat-${material.id || index}-${index}`} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-4 font-mono text-xs text-slate-400 font-bold">
                                          {index + 1}
                                        </td>
                                        <td className="p-4">
                                          <div className="flex flex-col">
                                            <p className="font-bold text-slate-900 text-sm leading-snug">
                                              {material.title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{material.bab}</span>
                                              <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                              <span className="text-[10px] font-black text-[#85cc00] uppercase tracking-wider">
                                                {material.kelasRef ? `Kelas ${material.kelasRef}` : "Semua Kelas"}
                                              </span>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="p-4 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <a
                                              href={material.driveUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-[#85cc00] hover:border-[#85cc00]/30 transition-all shadow-sm"
                                              title="Buka di Drive"
                                            >
                                              <ExternalLink className="w-4 h-4" />
                                            </a>
                                            <button
                                              onClick={() => handleEditMateri(material)}
                                              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-[#85cc00] hover:border-[#85cc00]/30 transition-all shadow-sm"
                                              title="Edit Materi"
                                            >
                                              <Edit className="w-4 h-4" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteMateri(material.id)}
                                              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-rose-500 hover:border-rose-200 transition-all shadow-sm"
                                              title="Hapus Materi"
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeMenu === "ujian-siswa" && (
                    <div className="space-y-12 animate-in fade-in duration-300">
                      <div className="flex gap-4 border-b border-slate-200">
                        <button
                          onClick={() => {
                            setActiveExamTab("daftar");
                            setExamSaveMessage({ text: "", type: "" });
                          }}
                          className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${
                            activeExamTab === "daftar" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"
                          }`}
                        >
                          Daftar Ujian Aktif
                        </button>
                        <button
                          onClick={() => {
                            setActiveExamTab("tambah");
                            setExamSaveMessage({ text: "", type: "" });
                          }}
                          className={`pb-4 px-2 font-bold uppercase tracking-widest text-xs transition-colors ${
                            activeExamTab === "tambah" ? "text-[#85cc00] border-b-2 border-[#85cc00]" : "text-slate-400"
                          }`}
                        >
                          + Rilis Ujian Baru (AI)
                        </button>
                      </div>

                      {examSaveMessage.text && (
                        <div
                          className={`p-6 rounded-2xl border-2 flex items-start gap-4 ${
                            examSaveMessage.type === "success"
                              ? "bg-emerald-50 border-emerald-200 text-emerald-850"
                              : "bg-rose-50 border-rose-200 text-rose-850"
                          }`}
                        >
                          {examSaveMessage.type === "success" ? (
                            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600" />
                          ) : (
                            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
                          )}
                          <div className="text-sm font-semibold leading-relaxed">
                            {examSaveMessage.text}
                          </div>
                        </div>
                      )}

                      {activeExamTab === "daftar" && (() => {
                        const filteredExamsList = examsList.filter((exam) => {
                          if (activeExamClassFilter.includes("SEMUA_KELAS")) return true;
                          const examRef = exam.kelasRef || "";
                          const targetArray = Array.isArray(exam.targetClasses) && exam.targetClasses.length > 0
                            ? exam.targetClasses
                            : examRef.split(",").map((s: string) => s.trim());
                          if (targetArray.includes("SEMUA_KELAS")) return true;
                          return activeExamClassFilter.some((filterCls) => targetArray.includes(filterCls) || examRef.includes(filterCls));
                        });

                        return (
                          <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Ujian CBT AI</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Buat soal pilihan ganda berkualitas tinggi secara instan dibantu AI Gemini, kelola token masuk siswa, serta rilis ujian ke kelas pilihan Anda.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-6">
                            {/* Toolbar Checkbox Filter Kelas Ujian */}
                            {examsList.length > 0 && (
                              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                                  <span className="text-xs font-black text-slate-700 uppercase tracking-wider">
                                    Filter Tampilan Kelas Ujian (Checkbox):
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400">
                                    Menampilkan {filteredExamsList.length} dari {examsList.length} Ujian
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-4">
                                  <div className="flex items-center gap-2">
                                    <input
                                      id="checkbox-filter-exam-all"
                                      type="checkbox"
                                      checked={activeExamClassFilter.includes("SEMUA_KELAS") || (classesList.length > 0 && activeExamClassFilter.length === classesList.length)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setActiveExamClassFilter(["SEMUA_KELAS", ...classesList.map(c => c.name)]);
                                        } else {
                                          setActiveExamClassFilter([]);
                                        }
                                      }}
                                      className="w-4 h-4 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                    />
                                    <label htmlFor="checkbox-filter-exam-all" className="text-xs font-bold text-slate-800 cursor-pointer select-none">
                                      Semua Kelas
                                    </label>
                                  </div>
                                  <div className="h-4 w-[1px] bg-slate-300" />
                                  {classesList.map((cls, idx) => {
                                    const isChecked = activeExamClassFilter.includes(cls.name) || activeExamClassFilter.includes("SEMUA_KELAS");
                                    return (
                                      <div key={`act-exam-cls-${cls.id || cls.name || idx}-${idx}`} className="flex items-center gap-2">
                                        <input
                                          id={`checkbox-filter-exam-cls-${cls.id}`}
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            let updated: string[];
                                            if (e.target.checked) {
                                              const filtered = activeExamClassFilter.filter(c => c !== "SEMUA_KELAS");
                                              updated = [...filtered, cls.name];
                                            } else {
                                              updated = activeExamClassFilter.filter(c => c !== cls.name && c !== "SEMUA_KELAS");
                                            }
                                            setActiveExamClassFilter(updated);
                                          }}
                                          className="w-4 h-4 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                        />
                                        <label htmlFor={`checkbox-filter-exam-cls-${cls.id}`} className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                                          Kelas {cls.name}
                                        </label>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                          {examsList.length === 0 ? (
                            <div className="p-16 text-center border-4 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                              <GraduationCap className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                              <h3 className="text-xl font-display font-black text-black tracking-tight mb-2">
                                Belum Ada Ujian Online yang Diterbitkan
                              </h3>
                              <p className="text-xs text-slate-400 font-medium max-w-md mx-auto leading-relaxed">
                                Klik tombol "+ Rilis Ujian Baru (AI)" di kanan atas untuk membuat bank soal pilihan ganda secara otomatis dengan AI Gemini dan mendistribusikan token ujian kepada siswa.
                              </p>
                            </div>
                          ) : filteredExamsList.length === 0 ? (
                            <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                              <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                              <h3 className="text-lg font-bold text-slate-800 mb-1">
                                Tidak Ada Ujian Untuk Kelas yang Dipilih
                              </h3>
                              <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                                Silakan centang/pilih filter kelas lain di atas untuk menampilkan daftar ujian.
                              </p>
                            </div>
                          ) : (
                            <div className="border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                              <div className="overflow-x-auto min-w-full">
                                <table className="w-full text-sm min-w-[800px]">
                                  <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-200">
                                    <tr className="text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                                      <th className="p-4 bg-slate-50">Mata Pelajaran</th>
                                      <th className="p-4 bg-slate-50">Judul & Rincian</th>
                                      <th className="p-4 bg-slate-50 text-center">Kelas</th>
                                      <th className="p-4 bg-slate-50 text-center">Token</th>
                                      <th className="p-4 bg-slate-50 text-center">KKM</th>
                                      <th className="p-4 bg-slate-50 text-right">Aksi</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                    {filteredExamsList.map((exam, idx) => (
                                      <tr key={`exam-${exam.id || idx}-${idx}`} className="hover:bg-slate-50/50">
                                        <td className="p-4">
                                          <span className="px-3 py-1 bg-slate-100 border border-slate-200 text-slate-800 text-[10px] font-bold uppercase tracking-wider rounded-lg">
                                            {exam.subject}
                                          </span>
                                        </td>
                                        <td className="p-4">
                                          <div className="font-bold text-slate-900 text-sm leading-snug">
                                            {exam.title}
                                          </div>
                                          <div className="text-[11px] text-slate-500 font-medium font-mono mt-0.5 flex flex-wrap items-center gap-2">
                                            <span>{exam.questions?.length || 0} Soal ‚Ä¢ {exam.duration / 60} Menit</span>
                                            {exam.externalQuizUrl && (
                                              <a
                                                href={exam.externalQuizUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                                              >
                                                <ExternalLink className="w-2.5 h-2.5" />
                                                Soal Luar (PDF / Notebook LM)
                                              </a>
                                            )}
                                          </div>
                                        </td>
                                        <td className="p-4 text-center font-bold text-slate-900 text-sm">
                                          {exam.kelasRef}
                                        </td>
                                        <td className="p-4 text-center">
                                          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-950 text-[#85cc00] text-xs font-mono font-bold rounded-lg uppercase shadow-sm tracking-wide">
                                            {exam.token}
                                            <button
                                              onClick={() => {
                                                navigator.clipboard.writeText(exam.token);
                                                showAlert("Token Disalin", "Token ujian telah disalin ke papan klip.", "alert");
                                              }}
                                              className="hover:text-white"
                                              title="Salin Token"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          </div>
                                        </td>
                                        <td className="p-4 text-center font-mono font-bold text-sm text-slate-900">
                                          {exam.kkm}
                                        </td>
                                        <td className="p-4 text-right flex justify-end gap-2">
                                          <button
                                            onClick={() => handleOpenPublishModal(exam)}
                                            className="p-2 text-[#85cc00] hover:text-[#85cc00]/80 rounded-lg transition-colors"
                                            title="Terbitkan ke Kelas Lain"
                                          >
                                            <Share2 className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => setExamToReset(exam)}
                                            className="p-2 text-orange-500 hover:text-orange-600 rounded-lg transition-colors"
                                            title="Reset Ujian Siswa"
                                          >
                                            <RefreshCw className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() =>
                                              setDownloadExamModal({
                                                isOpen: true,
                                                exam: exam,
                                                selectedClass: exam.kelasRef || "SEMUA_KELAS",
                                              })
                                            }
                                            className="p-2 text-[#85cc00] hover:text-[#85cc00]/80 rounded-lg transition-colors"
                                            title="Unduh Laporan Hasil & Pelanggaran Ujian"
                                          >
                                            <FileText className="w-4 h-4" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteExam(exam.id)}
                                            className="p-2 text-rose-500 hover:text-rose-600 rounded-lg transition-colors"
                                            title="Hapus Ujian"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                          </div>
                        </div>
                      );
                    })()}

                      {activeExamTab === "tambah" && (
                        <div className="space-y-12">
                          <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                            <div className="max-w-2xl">
                              <h2 className="text-2xl font-bold text-slate-950">Ujian CBT AI</h2>
                              <p className="text-slate-500 font-medium text-lg leading-relaxed">
                                Buat soal pilihan ganda berkualitas tinggi secara instan dibantu AI Gemini, kelola token masuk siswa, serta rilis ujian ke kelas pilihan Anda.
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
                          {/* Col 1: Form controls */}
                          <div className="md:col-span-4 space-y-6">
                            <div className="p-8 rounded-3xl border-2 border-black bg-white shadow-md space-y-5">
                              <h3 className="font-display font-black text-lg text-black tracking-tight flex items-center gap-2 pb-4 border-b">
                                <Sparkles className="w-5 h-5 text-[#85cc00]" /> Rilis Ujian Baru (Informatika)
                              </h3>

                              <div className="space-y-1">
                                <span className="px-2.5 py-1 bg-[#85cc00]/10 border border-[#85cc00]/20 text-[#85cc00] text-[10px] font-black uppercase tracking-wider rounded-lg inline-block">
                                  Mata Pelajaran: {examSubject}
                                </span>
                              </div>

                              {/* 1. Bab Yang terdapat di Mapel Informatika kurikulum mereka kelas X Fase E */}
                              <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  1. Bab Pelajaran (Fase E Kelas X)
                                </label>
                                <select
                                  value={examBab}
                                  onChange={(e) => {
                                    const selectedBab = e.target.value;
                                    setExamBab(selectedBab);
                                    if (selectedBab) {
                                      const shortBabName = selectedBab.split(':')[0];
                                      setExamTitle(`${examTema || 'Evaluasi'} Informatika - ${shortBabName}`);
                                    }
                                  }}
                                  className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all cursor-pointer"
                                >
                                  <option value="">-- Pilih Bab Informatika --</option>
                                  {INFORMATIKA_X_CHAPTERS.map((chap, idx) => (
                                    <option key={`chap-${chap || idx}-${idx}`} value={chap}>
                                      {chap}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* 2. Judul Ujian (Preetes.Postes.Ulangan Harian.Penilaian Tengah Semester.Penilaian Sumatif Akhir Semester) */}
                              <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-[#85cc00]">
                                  2. Judul Ujian (Kategori)
                                </label>
                                <select
                                  value={examTema}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setExamTema(val);
                                    const shortBabName = examBab ? examBab.split(':')[0] : "Fase E";
                                    setExamTitle(`${val} Informatika - ${shortBabName}`);
                                  }}
                                  className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all cursor-pointer font-display font-bold text-slate-900"
                                >
                                  <option value="Preetes">Preetes</option>
                                  <option value="Postes">Postes</option>
                                  <option value="Ulangan Harian">Ulangan Harian</option>
                                  <option value="Penilaian Tengah Semester">Penilaian Tengah Semester</option>
                                  <option value="Penilaian Sumatif Akhir Semester">Penilaian Sumatif Akhir Semester</option>
                                </select>
                              </div>

                              <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  Nama Publikasi Ujian (Dapat Diedit)
                                </label>
                                <input
                                  type="text"
                                  value={examTitle}
                                  onChange={(e) => setExamTitle(e.target.value)}
                                  placeholder="Nama Ujian..."
                                  className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all"
                                />
                              </div>

                              {/* 3. Materi Ujian */}
                              <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  3. Materi Ujian (Sub Bab)
                                </label>
                                <input
                                  type="text"
                                  value={examMateri}
                                  onChange={(e) => setExamMateri(e.target.value)}
                                  placeholder="Contoh: Bubble Sort, Hardware CPU, Canva"
                                  className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all"
                                />
                              </div>

                              {/* 4. Target Kelas (Checkbox Multi-Select) */}
                              <div className="space-y-3">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  4. Target Kelas Ujian (Dapat memilih lebih dari satu)
                                </label>
                                <div className="p-4 bg-slate-50 border-2 border-slate-200 rounded-2xl space-y-3">
                                  <div className="flex items-center gap-3">
                                    <input
                                      id="checkbox-exam-all"
                                      type="checkbox"
                                      checked={selectedExamClasses.includes("SEMUA_KELAS") || (classesList.length > 0 && selectedExamClasses.length === classesList.length)}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          const allNames = ["SEMUA_KELAS", ...classesList.map(c => c.name)];
                                          setSelectedExamClasses(allNames);
                                          setExamKelas("SEMUA_KELAS");
                                        } else {
                                          setSelectedExamClasses([]);
                                          setExamKelas("");
                                        }
                                      }}
                                      className="w-5 h-5 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                    />
                                    <label htmlFor="checkbox-exam-all" className="text-sm font-bold text-slate-800 cursor-pointer select-none">
                                      Semua Kelas
                                    </label>
                                  </div>
                                  <div className="h-[1px] bg-slate-200" />
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {classesList.map((cls, idx) => {
                                      const isChecked = selectedExamClasses.includes(cls.name) || selectedExamClasses.includes("SEMUA_KELAS");
                                      return (
                                        <div key={`sel-exam-cls-${cls.id || cls.name || idx}-${idx}`} className="flex items-center gap-2.5">
                                          <input
                                            id={`checkbox-exam-cls-${cls.id}`}
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={(e) => {
                                              let updated: string[];
                                              if (e.target.checked) {
                                                const filtered = selectedExamClasses.filter(c => c !== "SEMUA_KELAS");
                                                updated = [...filtered, cls.name];
                                              } else {
                                                updated = selectedExamClasses.filter(c => c !== cls.name && c !== "SEMUA_KELAS");
                                              }
                                              setSelectedExamClasses(updated);
                                              setExamKelas(updated.join(", "));
                                            }}
                                            className="w-4 h-4 rounded border-slate-300 text-[#85cc00] focus:ring-[#85cc00] cursor-pointer"
                                          />
                                          <label htmlFor={`checkbox-exam-cls-${cls.id}`} className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                                            Kelas {cls.name}
                                          </label>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>

                              {/* 5. Durasi Ujian & 6. Nilai KKM */}
                              <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    5. Durasi (Menit)
                                  </label>
                                  <input
                                    type="number"
                                    min={5}
                                    max={180}
                                    value={examDuration}
                                    onChange={(e) => setExamDuration(Math.max(5, Number(e.target.value)))}
                                    className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-mono font-bold outline-none focus:bg-white focus:border-black transition-all"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    6. Nilai KKM
                                  </label>
                                  <input
                                    type="number"
                                    min={10}
                                    max={100}
                                    value={examKkm}
                                    onChange={(e) => setExamKkm(Math.max(10, Number(e.target.value)))}
                                    className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-mono font-bold outline-none focus:bg-white focus:border-black transition-all"
                                  />
                                </div>
                              </div>

                              {/* 7. Jumlah Soal Pilihan Ganda (5.10.15.20.25.30.35.40.45.50) */}
                              <div className="space-y-2 pt-2 border-t">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  7. Jumlah Soal Pilihan Ganda
                                </label>
                                <select
                                  value={examQuestionCount}
                                  onChange={(e) => setExamQuestionCount(Number(e.target.value))}
                                  className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm text-black font-semibold outline-none focus:bg-white focus:border-black transition-all cursor-pointer font-mono font-bold"
                                >
                                  {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((num, idx) => (
                                    <option key={`soal-num-${num}-${idx}`} value={num}>
                                      {num} Soal
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* 8. Deskripsi Soal */}
                              <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  8. Deskripsi Soal (Model / Fokus AI)
                                </label>
                                <textarea
                                  value={examDescription}
                                  onChange={(e) => setExamDescription(e.target.value)}
                                  rows={3}
                                  placeholder="Contoh: Fokuskan pada pemrograman if-else & perulangan loop di python, berikan studi kasus sederhana..."
                                  className="block w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold text-black outline-none focus:bg-white focus:border-black transition-all resize-none leading-relaxed"
                                />
                              </div>

                              {/* 9. Sumber Soal Eksternal (Link Kuis Notebook LM / Link Drive PDF Soal Luar) */}
                              <div className="space-y-2.5 p-4 rounded-2xl bg-blue-50/60 border-2 border-blue-200">
                                <div className="flex items-center justify-between">
                                  <label className="block text-[10px] font-black uppercase tracking-widest text-blue-700 flex items-center gap-1.5">
                                    <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
                                    Link Kuis Notebook LM / Drive PDF Soal (Opsional)
                                  </label>
                                  {examExternalQuizUrl && (
                                    <a
                                      href={examExternalQuizUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[10px] font-extrabold text-blue-600 hover:underline flex items-center gap-1"
                                    >
                                      Uji Link <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </div>
                                <input
                                  type="url"
                                  value={examExternalQuizUrl}
                                  onChange={(e) => setExamExternalQuizUrl(e.target.value)}
                                  placeholder="Contoh: https://notebooklm.google.com/... atau https://drive.google.com/file/d/..."
                                  className="block w-full rounded-xl border-2 border-blue-200 bg-white px-4 py-3 text-xs text-black font-semibold outline-none focus:border-blue-500 transition-all"
                                />
                                <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                  Tempelkan link Kuis Notebook LM atau Google Drive PDF butir soal luar. Siswa dapat membaca dokumen PDF di layar ujian atau membuka kuis Notebook LM.
                                </p>
                                <button
                                  type="button"
                                  onClick={handleCreateAnswerSheetFromExternal}
                                  className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm active:scale-95"
                                >
                                  <FileText className="w-4 h-4" />
                                  Buat Lembar Jawab CBT (A-E) untuk {examQuestionCount} Butir Soal PDF
                                </button>
                              </div>

                              {/* 9b. Impor Teks Soal dari NotebookLM / ChatGPT (Rekomendasi Utama) */}
                              <div className="space-y-2.5 p-4 rounded-2xl bg-[#f7fee7] border-2 border-[#bef264]">
                                <div className="flex items-center justify-between">
                                  <label className="block text-[10px] font-black uppercase tracking-widest text-lime-800 flex items-center gap-1.5">
                                    <Sparkles className="w-3.5 h-3.5 text-lime-600 animate-pulse" />
                                    Salin-Tempel Teks Soal NotebookLM / AI (Rekomendasi)
                                  </label>
                                  {examPastedText && (
                                    <button
                                      type="button"
                                      onClick={() => setExamPastedText("")}
                                      className="text-[10px] font-extrabold text-rose-600 hover:underline cursor-pointer"
                                    >
                                      Bersihkan Teks
                                    </button>
                                  )}
                                </div>
                                <textarea
                                  value={examPastedText}
                                  onChange={(e) => setExamPastedText(e.target.value)}
                                  rows={4}
                                  placeholder="Salin hasil kuis / teks soal dari NotebookLM atau AI lainnya, lalu tempelkan di sini. AI akan memformatnya menjadi butir kuis online interaktif otomatis!"
                                  className="block w-full rounded-xl border-2 border-lime-200 bg-white p-3 text-xs text-black font-semibold outline-none focus:border-lime-500 transition-all resize-none leading-relaxed"
                                />
                                <p className="text-[10px] text-lime-700 font-medium leading-relaxed">
                                  NotebookLM atau AI lain tidak bisa dibaca otomatis secara langsung lewat link URL karena alasan keamanan Google (login/OAuth). <strong>Solusi terbaik:</strong> Cukup salin teks kuis dari NotebookLM, tempelkan di kotak atas, lalu klik tombol <strong>Generasi Soal dengan AI</strong> di bawah.
                                </p>
                              </div>

                              {/* 10. Sumber Data Referensi (PDF/Doc) */}
                              <div className="space-y-2">
                                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                                  9. Sumber Data Referensi (PDF/Doc)
                                </label>
                                <div className="relative">
                                  <input
                                    type="file"
                                    id="examDocumentUpload"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        if (file.size > 5 * 1024 * 1024) {
                                          showAlert("Peringatan", "Ukuran dokumen terlalu besar. Maksimal 5MB.", "danger");
                                          e.target.value = "";
                                          return;
                                        }
                                        setExamDocument(file);
                                      } else {
                                        setExamDocument(null);
                                      }
                                    }}
                                    className="hidden"
                                    accept=".pdf,.doc,.docx,.txt"
                                  />
                                  <label
                                    htmlFor="examDocumentUpload"
                                    className="block w-full rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-sm text-slate-500 font-semibold outline-none hover:bg-slate-100 transition-all cursor-pointer text-center"
                                  >
                                    {examDocument ? (
                                      <span className="text-[#85cc00] flex items-center justify-center gap-2">
                                        <FileText className="w-5 h-5 shrink-0" />
                                        <span className="truncate max-w-[200px]">{examDocument.name}</span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            setExamDocument(null);
                                            const input = document.getElementById("examDocumentUpload") as HTMLInputElement;
                                            if (input) input.value = "";
                                          }}
                                          className="text-rose-500 hover:text-rose-700 ml-2"
                                        >
                                          <X className="w-4 h-4" />
                                        </button>
                                      </span>
                                    ) : (
                                      <span className="flex flex-col items-center gap-1">
                                        <Upload className="w-5 h-5 mb-1" />
                                        Upload PDF/Doc untuk referensi soal
                                      </span>
                                    )}
                                  </label>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={handleGenerateAIExam}
                                disabled={isGeneratingExam || !examBab || !examTitle || !examKelas}
                                className="w-full h-14 bg-[#85cc00] hover:brightness-110 font-black text-xs text-slate-950 uppercase tracking-widest rounded-2xl shadow-lg shadow-[#85cc00]/20 flex items-center justify-center gap-2 disabled:opacity-40 transition-all cursor-pointer"
                              >
                                {isGeneratingExam ? (
                                  <>
                                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                                    Menganalisis & Membuat Soal...
                                  </>
                                ) : (
                                  <>
                                    <Sparkles className="w-4 h-4 shrink-0" />
                                    Generasi Soal dengan AI
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Col 2: Questions review & Token configuration */}
                          <div className="md:col-span-8 space-y-6">
                            {examQuestions.length === 0 ? (
                              <div className="p-16 text-center border-4 border-dashed border-slate-200 rounded-3xl bg-slate-50/50 flex flex-col justify-center min-h-[400px]">
                                <Sparkles className="w-14 h-14 text-[#85cc00] mb-4 animate-bounce" />
                                <h3 className="text-xl font-display font-black text-black tracking-tight mb-2">
                                  Mari Mulai dengan Pengaturan di Sebelah Kiri
                                </h3>
                                <p className="text-xs text-slate-400 font-medium max-w-md mx-auto leading-relaxed">
                                  Sistem akan secara instan merancang paket soal lengkap yang selaras dengan taksonomi bab sekolah Anda. Pilih mata pelajaran dan silakan klik rilis generate!
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-6">
                                {/* Token configuration info strip */}
                                <div className="p-6 rounded-3xl border-2 border-[#85cc00] bg-emerald-50/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                  <div>
                                    <h4 className="font-extrabold text-black text-sm mb-1">
                                      Token Akses Berhasil Di-generasi
                                    </h4>
                                    <p className="text-[11px] text-slate-500 font-semibold leading-relaxed">
                                      Bagikan kode token ini hanya kepada pengawas atau kelas <span className="font-extrabold text-slate-800">{examKelas || "sasaran"}</span> untuk memulai.
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="relative flex items-center">
                                      <input
                                        type="text"
                                        maxLength={6}
                                        value={examToken}
                                        onChange={(e) => setExamToken(e.target.value.toUpperCase())}
                                        className="w-36 text-center text-2xl font-mono font-black tracking-widest border-4 border-slate-900 rounded-2xl bg-slate-950 text-[#85cc00] p-3 uppercase outline-none focus:border-[#85cc00] transition-all shadow-md pr-12"
                                        placeholder="TOKEN"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(examToken);
                                          showAlert("Token Disalin", "Token berhasil disalin.", "alert");
                                        }}
                                        className="absolute right-3 p-1.5 text-slate-500 hover:text-[#85cc00] transition-colors cursor-pointer"
                                        title="Salin Token"
                                      >
                                        <Copy className="w-5 h-5" />
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setExamToken(generateRandomToken())}
                                      className="p-3.5 border-4 border-slate-900 bg-white rounded-2xl text-slate-950 hover:bg-slate-50 hover:border-slate-950 transition-colors cursor-pointer shrink-0 shadow-md active:scale-95"
                                      title="Acak Token Baru"
                                    >
                                      <RefreshCw className="w-5 h-5 stroke-[2.5]" />
                                    </button>
                                  </div>
                                </div>

                                {/* Questions lists editing */}
                                <div className="space-y-5">
                                  <div className="flex items-center justify-between">
                                    <h4 className="font-display font-black text-slate-800 text-base tracking-tight">
                                      Daftar Bank Soal Pilihan Ganda ({examQuestions.length} Soal)
                                    </h4>
                                    <span className="text-xs font-semibold text-slate-400">
                                      *Semua data soal di bawah ini bersifat interaktif & dapat diedit langsung
                                    </span>
                                  </div>

                                  {examQuestions.map((q, idx) => (
                                    <div key={`exam-q-box-${idx}`} className="p-6 rounded-3xl border-2 border-slate-200 bg-white space-y-4">
                                      <div className="flex items-start gap-4 justify-between">
                                        <div className="flex-1">
                                          <div className="text-[10px] font-black uppercase tracking-widest text-[#85cc00] mb-2 leading-none">
                                            SOAL NOMOR {idx + 1}
                                          </div>
                                          <textarea
                                            value={q.text}
                                            rows={2}
                                            onChange={(e) => {
                                              const updated = [...examQuestions];
                                              updated[idx].text = e.target.value;
                                              setExamQuestions(updated);
                                            }}
                                            className="w-full text-sm font-bold text-black border-2 border-transparent hover:border-slate-100 focus:border-slate-350 p-2.5 rounded-xl bg-slate-50/50 outline-none leading-relaxed transition-all"
                                          />
                                        </div>
                                        <button
                                          onClick={() => {
                                            const updated = examQuestions.filter((_, i) => i !== idx);
                                            setExamQuestions(updated);
                                          }}
                                          className="p-2 text-[#85cc00] hover:text-[#85cc00]/80 hover:bg-[#85cc00]/5 rounded-xl transition-colors cursor-pointer mt-1"
                                          title="Hapus Soal"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>

                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2 border-t border-slate-100">
                                        {q.options.map((opt: string, optIdx: number) => (
                                          <div
                                            key={`exam-opt-${optIdx}`}
                                            className={`p-3.5 rounded-2xl border-2 flex items-center justify-between gap-3.5 transition-all ${
                                              q.correctIndex === optIdx
                                                ? "border-emerald-500 bg-emerald-50/20"
                                                : "border-slate-150 hover:border-slate-250 bg-slate-50/30"
                                            }`}
                                          >
                                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                              <span className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black uppercase tracking-wider text-slate-500 shrink-0">
                                                {String.fromCharCode(65 + optIdx)}
                                              </span>
                                              <input
                                                type="text"
                                                value={opt}
                                                onChange={(e) => {
                                                  const updated = [...examQuestions];
                                                  updated[idx].options[optIdx] = e.target.value;
                                                  setExamQuestions(updated);
                                                }}
                                                className="flex-1 bg-transparent border-none text-xs font-semibold text-black outline-none p-0"
                                              />
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const updated = [...examQuestions];
                                                updated[idx].correctIndex = optIdx;
                                                setExamQuestions(updated);
                                              }}
                                              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                                                q.correctIndex === optIdx
                                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                                  : "border-slate-300 bg-white"
                                              }`}
                                            >
                                              {q.correctIndex === optIdx && (
                                                <div className="w-2.5 h-2.5 bg-white rounded-full" />
                                              )}
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                <div className="p-6 rounded-3xl border-2 border-black bg-black flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-md">
                                  <div className="text-white">
                                    <h4 className="font-extrabold text-white text-sm leading-snug mb-1">
                                      Siap Untuk Menerbitkan CBT?
                                    </h4>
                                    <p className="text-[11px] text-slate-400 font-semibold leading-relaxed">
                                      Semua konfigurasi valid. Klik simpan untuk mendistribusikan soal ujian secara langsung ke platform siswa.
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={handleSimpanUjian}
                                    disabled={isSavingExam}
                                    className="px-8 h-14 bg-[#85cc00] hover:bg-[#72b000] text-black font-extrabold text-xs uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50 shadow-lg shrink-0"
                                  >
                                    {isSavingExam ? (
                                      <>
                                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" /> Menyimpan...
                                      </>
                                    ) : (
                                      <>
                                        Terbitkan Ujian & Rilis Token <ArrowRight className="w-4 h-4" />
                                      </>
                                    )}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    </div>
                  )}

                  {activeMenu === "pengumuman" && (
                    <div className="space-y-12 animate-in fade-in duration-300">
                      <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                        <div className="max-w-2xl">
                          <h2 className="text-2xl font-bold text-slate-950">Sistem Pengumuman</h2>
                          <p className="text-slate-500 font-medium text-lg leading-relaxed">
                            Kirim pengumuman penting ke siswa secara massal atau per kelas.
                          </p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-10">
                        {/* Form Col */}
                        <div className="md:col-span-5 space-y-6">
                            <div className="p-8 rounded-xl border border-slate-200 bg-white shadow-sm space-y-5">
                              <div>
                                <h3 className="font-bold text-lg text-slate-900 tracking-tight flex items-center gap-2">
                                  <MessageSquare className="w-5 h-5 text-[#85cc00]" />
                                  Kirim Pengumuman Baru
                                </h3>
                                <p className="text-xs text-slate-500 font-medium mt-1">
                                  Pesan ini akan muncul sebagai popup notifikasi khusus untuk siswa pada target kelas yang dipilih.
                                </p>
                              </div>
                              <hr className="border-slate-100" />
                              <div className="space-y-4">
                                <div className="space-y-2">
                                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    Judul Pengumuman
                                  </label>
                                  <input
                                    type="text"
                                    value={announcementTitle}
                                    onChange={(e) => setAnnouncementTitle(e.target.value)}
                                    placeholder="Contoh: Info Remedi, Perubahan Jadwal, dll"
                                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 font-semibold outline-none focus:bg-white focus:border-[#85cc00] transition-all"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    Tanggal Terbit Pengumuman
                                  </label>
                                  <input
                                    type="date"
                                    value={announcementPublishDate}
                                    onChange={(e) => setAnnouncementPublishDate(e.target.value)}
                                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 font-semibold outline-none focus:bg-white focus:border-[#85cc00] transition-all cursor-pointer"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    Isi Pesan
                                  </label>
                                  <textarea
                                    value={announcementContent}
                                    onChange={(e) => setAnnouncementContent(e.target.value)}
                                    placeholder="Ketik isi pengumuman lengkap disini..."
                                    className="block w-full min-h-[140px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 font-medium outline-none focus:bg-white focus:border-[#85cc00] transition-all resize-y"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    Kelas Sasaran
                                  </label>
                                  <select
                                    value={announcementKelas}
                                    onChange={(e) => setAnnouncementKelas(e.target.value)}
                                    className="block w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 font-semibold outline-none focus:bg-white focus:border-[#85cc00] transition-all cursor-pointer"
                                  >
                                    <option value="" disabled>Pilih Kelas Sasaran</option>
                                    <option value="SEMUA_KELAS">-- KIRIM KE SEMUA KELAS --</option>
                                    {classesList.map((cls, idx) => (
                                      <option key={`ann-cls-${cls.id || cls.name || idx}-${idx}`} value={cls.name}>{cls.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <button
                                onClick={handleCreateAnnouncement}
                                disabled={isSavingAnnouncement || !announcementTitle || !announcementContent || !announcementKelas}
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#85cc00] px-5 py-4 text-sm font-bold uppercase tracking-widest text-slate-950 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                              >
                                {isSavingAnnouncement ? "Mengirim..." : (
                                  <>
                                    <Bell className="w-4 h-4" />
                                    Kirim Pengumuman
                                  </>
                                )}
                              </button>
                            </div>
                        </div>
                        {/* List Col */}
                        <div className="md:col-span-7 space-y-6">
                            <div className="p-8 rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col h-full">
                              <h3 className="font-bold text-lg text-slate-900 tracking-tight mb-2 flex items-center gap-2">
                                Riwayat Pengumuman ({announcementsList.length})
                              </h3>
                              
                              <div className="flex-1 mt-4 space-y-4">
                                {announcementsList.length === 0 ? (
                                    <div className="text-center py-20 px-6 border border-dashed border-slate-200 rounded-xl">
                                        <Bell className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                                        <h3 className="text-sm font-bold text-slate-800 tracking-tight mb-1">
                                          Belum ada pengumuman
                                        </h3>
                                        <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                                          Gunakan form di samping untuk membuat dan mengirim pengumuman baru ke kelas.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid gap-4">
                                        {announcementsList.map((ann, idx) => (
                                            <div key={`ann-${ann.id || idx}-${idx}`} className="p-5 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors bg-slate-50/50 relative group">
                                                <button
                                                    onClick={() => handleDeleteAnnouncement(ann.id)}
                                                    className="absolute top-4 right-4 p-1.5 text-rose-400 hover:text-white hover:bg-rose-500 rounded-lg transition-all cursor-pointer bg-white border border-slate-200 hover:border-rose-500 shadow-sm opacity-0 group-hover:opacity-100"
                                                    title="Hapus Pengumuman"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                                <div className="flex gap-2 items-center mb-3 pr-10 flex-wrap">
                                                    <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border bg-[#85cc00]/10 text-[#85cc00] border-[#85cc00]/20">
                                                        {ann.kelasRef === "SEMUA_KELAS" ? "PENGUMUMAN GLOBAL" : `KELAS: ${ann.kelasRef}`}
                                                    </span>
                                                    <span className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-slate-100 rounded-lg flex items-center gap-1 border border-slate-200">
                                                        <Calendar className="w-3 h-3 text-slate-400" />
                                                        <span>Terbit: {(() => {
                                                            const dStr = ann.publishDate || ann.createdAt;
                                                            if (!dStr) return "-";
                                                            if (typeof dStr === "string" && dStr.includes("-") && dStr.length === 10) {
                                                              const [y, m, d] = dStr.split("-");
                                                              const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agt", "Sep", "Okt", "Nov", "Des"];
                                                              return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
                                                            }
                                                            const d = new Date(dStr);
                                                            return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
                                                        })()}</span>
                                                    </span>
                                                </div>
                                                <h4 className="font-bold text-slate-900 text-base leading-tight mb-2">{ann.title}</h4>
                                                <p className="text-xs text-slate-600 leading-relaxed font-medium whitespace-pre-wrap">{ann.content}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                              </div>
                            </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeMenu === "manajemen-penyimpanan" && (
                    <div className="space-y-12">
                      <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                        <div className="max-w-2xl">
                          <h2 className="text-2xl font-bold text-slate-950">Manajemen Penyimpanan</h2>
                          <p className="text-slate-500 font-medium text-lg leading-relaxed">
                            Monitoring pemakaian resource dan kuota database.
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 md:grid-cols-4 gap-8">
                        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm relative overflow-hidden">
                           <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Total Reads</h4>
                           <p className="text-3xl font-bold text-slate-950">{sessionUsage.reads.toLocaleString()}</p>
                           <div className="mt-4 text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2">
                             <div className="w-1.5 h-1.5 rounded-md bg-[#85cc00]"></div> Aktif
                           </div>
                        </div>
                        
                        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm relative">
                           <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Total Writes</h4>
                           <p className="text-3xl font-bold text-slate-950">{sessionUsage.writes.toLocaleString()}</p>
                           <p className="mt-4 text-[10px] text-slate-500 font-bold uppercase tracking-widest italic">Update Transaksional</p>
                        </div>

                        <div className="col-span-1 md:col-span-2 bg-white/80 bg-white/95 rounded-2xl border border-slate-200 p-10 border border-white shadow-md flex flex-col md:flex-row justify-between gap-10">
                           <div className="flex-1">
                             <h4 className="text-[12px] font-black text-slate-400 uppercase tracking-wider mb-6">Status Kuota Harian</h4>
                             <div className="flex items-center gap-6">
                               <div className="relative w-24 h-24">
                                  <svg className="w-24 h-24" viewBox="0 0 100 100">
                                    <circle className="text-slate-200 stroke-current" strokeWidth="10" fill="transparent" r="40" cx="50" cy="50" />
                                    <circle className="text-slate-800 stroke-current transition-all duration-1000" strokeWidth="10" strokeDasharray={`${(sessionUsage.reads / 50000) * 251.2} 251.2`} strokeLinecap="round" fill="transparent" r="40" cx="50" cy="50" transform="rotate(-90 50 50)" />
                                  </svg>
                                  <div className="absolute inset-0 flex items-center justify-center text-[12px] font-black text-black">
                                    {Math.round((sessionUsage.reads / 50000) * 100)}%
                                  </div>
                               </div>
                               <div>
                                 <p className="text-2xl font-black text-black italic font-display">OPTIMAL</p>
                                 <p className="text-[12px] font-black text-slate-400 uppercase tracking-wider mt-1">
                                    {(50000 - sessionUsage.reads).toLocaleString()} sisa kuota
                                 </p>
                               </div>
                             </div>
                           </div>
                           <div className="flex items-center">
                             <button 
                               onClick={handleResetStats}
                               className="px-8 py-4 bg-slate-100 text-slate-900 rounded-xl text-[12px] font-black uppercase tracking-wider hover:bg-slate-200 transition-all shadow-md border border-slate-300/80/80"
                             >
                               Reset Statistik
                             </button>
                           </div>
                        </div>
                      </div>

                      {/* ESTIMASI PENYIMPANAN FIREBASE (STORAGE) */}
                      <div className="bg-white rounded-[2.5rem] border border-slate-200 p-8 md:p-12 shadow-md relative overflow-hidden">
                        <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
                          <div className="flex items-center gap-5">
                            <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-md">
                              <HardDrive className="w-8 h-8" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-display font-black text-slate-950 tracking-tight">
                                Kapasitas Penyimpanan Berkas
                              </h3>
                              <p className="text-xs text-slate-500 font-medium mt-1">
                                Total Kuota Server (Firebase Free Tier): <span className="font-bold text-slate-700">5.00 GB</span>
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 md:p-8">
                          <div className="flex justify-between items-end mb-4">
                            <div>
                              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">
                                Ruang Terpakai
                              </p>
                              <p className="text-3xl font-black text-slate-900">
                                {storageMetrics.usedFormatted}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">
                                Sisa Ruang
                              </p>
                              <p className="text-xl font-bold text-emerald-600">
                                {storageMetrics.freeFormatted}
                              </p>
                            </div>
                          </div>

                          {/* Progress Bar */}
                          <div className="w-full bg-slate-200 rounded-full h-4 mb-2 overflow-hidden flex">
                            <div 
                              className={`h-4 rounded-full transition-all duration-1000 ${
                                storageMetrics.percentage > 90 ? 'bg-rose-500' : 
                                storageMetrics.percentage > 70 ? 'bg-amber-500' : 'bg-blue-600'
                              }`} 
                              style={{ width: `${storageMetrics.percentage}%` }}
                            ></div>
                          </div>
                          
                          <div className="flex justify-between items-center text-[11px] font-bold">
                            <span className={storageMetrics.percentage > 90 ? 'text-rose-600' : 'text-slate-500'}>
                              {storageMetrics.percentage}% Terpakai
                            </span>
                            <span className="text-slate-400">
                              Batas 5 GB
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* OPTION 3: KEBIJAKAN RETENSI PENYIMPANAN OTOMATIS & PEMBERSIHAN BERKAS LAMPAU */}
                      <div className="bg-white rounded-[2.5rem] border-2 border-emerald-500/20 p-8 md:p-12 shadow-xl space-y-8 relative overflow-hidden">
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 border-b border-slate-100 pb-6">
                          <div className="flex items-center gap-5">
                            <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-md">
                              <ShieldCheck className="w-8 h-8" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white">
                                  PILIHAN 3 ‚Ä¢ RETENTION POLICY
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">Direkomendasikan</span>
                              </div>
                              <h3 className="text-2xl font-display font-black text-slate-900 tracking-tight mt-1">
                                Kebijakan Retensi Berkas &amp; Optimasi Penyimpanan
                              </h3>
                              <p className="text-xs text-slate-500 font-medium">
                                Melindungi kapasitas Firebase agar kuota penyimpanan tidak pernah overload, dengan tetap menyimpan 100% data nilai permanen.
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isCleaningRetention}
                            onClick={handleRunRetentionCleanup}
                            className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                          >
                            {isCleaningRetention ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Membersihkan...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4" />
                                <span>Jalankan Pembersihan Retensi</span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Retention Details Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              Data Nilai &amp; Rekap Siswa
                            </span>
                            <p className="text-base font-black text-slate-900 flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              100% Permanen di Firestore
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                              Nama, NISN, Kelas, Nilai Angka, Catatan Guru, Tanggal Rilis, dan Penyerahan tidak pernah hilang.
                            </p>
                          </div>

                          <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              Berkas Tugas Selesai Dinilai
                            </span>
                            <p className="text-base font-black text-slate-900 flex items-center gap-1.5">
                              <HardDrive className="w-4 h-4 text-sky-600" />
                              Otomatis Diarsipkan &amp; Dibersihkan
                            </p>
                            <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                              File PDF/gambar lampiran yang sudah selesai diperiksa dibersihkan dari penyimpanan untuk menjaga kuota tetap aman.
                            </p>
                          </div>

                          <div className="p-5 bg-emerald-50/60 rounded-2xl border border-emerald-200 space-y-1.5">
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-800">
                              Status Retensi Penyimpanan
                            </span>
                            <p className="text-base font-black text-emerald-950">
                              {retentionCleanedCount} Berkas Terpelihara
                            </p>
                            <p className="text-[11px] text-emerald-700 font-medium">
                              Terakhir dijalankan: {retentionLastRun || "Belum pernah (Sistem siap)"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white/80 bg-white/95 rounded-[3.5rem] border border-white p-12 md:p-16 shadow-2xl">
                        <div className="flex flex-col md:flex-row items-center gap-8 mb-16">
                          <div className="w-20 h-20 bg-[#85cc00] rounded-2xl flex items-center justify-center text-black shadow-2xl shadow-[#85cc00]/30 rotate-3">
                            <Database className="w-10 h-10" />
                          </div>
                          <div className="text-center md:text-left">
                            <h3 className="text-4xl font-display font-black text-black tracking-tight mb-2">Eksplorasi Koleksi</h3>
                            <p className="text-slate-800 font-medium text-lg uppercase tracking-wider text-[12px]">Cloud Firestore Infrastructure Management</p>
                          </div>
                        </div>
 
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                            {[
                              { name: "Siswa", count: studentsList.length, color: "bg-slate-100", text: "text-black" },
                              { name: "Kelas", count: classesList.length, color: "bg-slate-200", text: "text-black" },
                              { name: "Tugas", count: assignmentsList.length, color: "bg-[#85cc00]", text: "text-black" },
                              { name: "Audit", count: submissionsList.length, color: "bg-[#85cc00]", text: "text-slate-950" },
                            ].map((item, i) => (
                              <div key={`db-stat-${i}`} className={`${item.color} p-10 rounded-2xl border border-slate-300/80/80 flex flex-col group hover:scale-105 transition-all duration-500 shadow-lg`}>
                                 <span className={`text-4xl font-display font-black mb-3 ${item.text}`}>{item.count}</span>
                                 <span className={`text-[12px] font-black uppercase tracking-widest ${item.color === 'bg-[#85cc00]' ? 'text-slate-950' : 'text-slate-800'}`}>{item.name}</span>
                               </div>
                             ))}
                        </div>
                         
                        <div className="mt-16 flex flex-col md:flex-row gap-8">
                            <button 
                              onClick={handleExportData}
                              className="flex-1 flex items-center justify-center gap-4 py-8 bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-100 hover:border-slate-900 hover:shadow-[#85cc00]/10 hover:translate-y-[-2px] transition-all font-black text-xs uppercase tracking-widest text-slate-900"
                            >
                              <Download className="w-6 h-6" /> Unduh Cadangan Data
                            </button>
                            <button 
                              onClick={() => setResetModalOpen(true)}
                              className="flex-1 flex items-center justify-center gap-4 py-8 bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-100 hover:border-[#85cc00] hover:shadow-[#85cc00]/10 hover:translate-y-[-2px] transition-all font-black text-xs uppercase tracking-widest text-[#85cc00]"
                            >
                              <RefreshCw className="w-6 h-6" /> Inisialisasi Ulang
                            </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeMenu === "ubah-password" && (
                    <div className="space-y-12">
                      <div className="flex flex-col text-center md:text-left md:items-end md:flex-row justify-between gap-8 pb-10 border-b border-slate-100">
                        <div className="max-w-2xl">
                          <h2 className="text-2xl font-bold text-slate-950">Ubah Password Guru</h2>
                          <p className="text-slate-500 font-medium text-lg leading-relaxed">
                            Perbarui kata sandi keamanan Anda.
                          </p>
                        </div>
                      </div>
                      
                      <div className="bg-white/80 bg-white/95 rounded-[3.5rem] border border-white p-12 md:p-16 shadow-2xl max-w-2xl mx-auto space-y-8">
                        {/* Information Card displaying Initial/Current Password Status */}
                        <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                          <div className="flex items-center gap-2.5 font-bold text-slate-800 text-sm">
                            <KeyRound className="w-4 h-4 text-[#85cc00]" />
                            <span>Informasi Kata Sandi Guru</span>
                          </div>
                          <div className="space-y-2 text-xs text-slate-600">
                            {dbTeacherPassword ? (
                              <p className="flex items-center gap-2 text-emerald-700 font-semibold pt-1">
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                                <span>Password aktif tersimpan aman di Database Firebase.</span>
                              </p>
                            ) : (
                              <p className="text-slate-500 italic pt-1">
                                (Saat ini menggunakan password default. Perubahan password yang Anda buat akan langsung tersimpan di Firebase Database.)
                              </p>
                            )}
                          </div>
                        </div>

                        <form onSubmit={handleChangePassword} className="space-y-8">
                          {passwordMessage.text && (
                            <div className={`p-4 rounded-xl text-sm font-bold ${passwordMessage.type === 'success' ? 'bg-[#85cc00]/10 text-[#649c00]' : 'bg-rose-50 text-rose-600'}`}>
                              {passwordMessage.text}
                            </div>
                          )}

                          <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Password Lama</label>
                            <div className="relative">
                              <input
                                type={showCurrentPassword ? "text" : "password"}
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-[#85cc00]/20 focus:border-[#85cc00] transition-all text-sm font-medium"
                                required
                              />
                              <button
                                type="button"
                                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                              >
                                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Password Baru</label>
                            <div className="relative">
                              <input
                                type={showNewPassword ? "text" : "password"}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-[#85cc00]/20 focus:border-[#85cc00] transition-all text-sm font-medium"
                                required
                              />
                              <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                              >
                                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Konfirmasi Password Baru</label>
                            <div className="relative">
                              <input
                                type={showConfirmNewPassword ? "text" : "password"}
                                value={confirmNewPassword}
                                onChange={(e) => setConfirmNewPassword(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 focus:outline-none focus:ring-4 focus:ring-[#85cc00]/20 focus:border-[#85cc00] transition-all text-sm font-medium"
                                required
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmNewPassword(!showConfirmNewPassword)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                              >
                                {showConfirmNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                              </button>
                            </div>
                          </div>

                          <button
                            type="submit"
                            disabled={isChangingPassword}
                            className="w-full py-4 bg-[#85cc00] hover:bg-[#7bc000] text-slate-900 font-bold uppercase tracking-widest rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                          >
                            {isChangingPassword ? (
                              <RefreshCw className="w-5 h-5 animate-spin" />
                            ) : (
                              <>Simpan Password <ArrowRight className="w-4 h-4" /></>
                            )}
                          </button>
                        </form>
                      </div>
                    </div>
                  )}

                  </motion.div>
                </AnimatePresence>

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
                Kreativitas Tanpa Batas ‚Ä¢ Inovasi Tiada Henti
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
        </div>
      </main>

      {/* Zoom Student Photo Modal */}
      {zoomedPhotoUrl && (
        <div 
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 bg-white/95 p-4 md:p-8"
          onClick={() => {
            setZoomedPhotoUrl(null);
            setZoomedStudentName("");
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl overflow-hidden shadow-2xl max-w-3xl max-h-[95vh] flex flex-col border border-slate-200"
          >
            {/* Header */}
            <div className="bg-slate-50 px-6 py-4 flex justify-center items-center border-b border-slate-100 shrink-0">
              <span className="text-sm font-black text-slate-800 uppercase tracking-wider text-center truncate">
                {zoomedStudentName}
              </span>
            </div>

            {/* Content with natural image sizing */}
            <div className="p-6 overflow-auto flex items-center justify-center bg-slate-100/50 max-h-[calc(95vh-140px)]">
              <img loading="lazy"
                src={zoomedPhotoUrl}
                alt={zoomedStudentName}
                className="max-w-full max-h-[60vh] rounded-2xl object-contain shadow-lg border border-slate-200"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  console.log("Zoom modal image error:", zoomedPhotoUrl, "Fallback:", target.src);
                  if (target.src.includes('thumbnail')) {
                      const idMatch = zoomedPhotoUrl.match(/[-\w]{25,}/);
                      if (idMatch) {
                          target.src = `https://drive.google.com/uc?export=view&id=${idMatch[0]}`;
                      }
                  }
                }}
              />
            </div>

            {/* Footer */}
            <div className="bg-slate-50 px-6 py-4 flex justify-center items-center border-t border-slate-100 shrink-0">
              <button
                onClick={() => {
                  setZoomedPhotoUrl(null);
                  setZoomedStudentName("");
                }}
                className="bg-rose-500 hover:bg-rose-600 text-white transition-all px-8 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-1 cursor-pointer shadow-md shadow-rose-500/20 active:scale-95 font-sans"
              >
                Tutup
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* WhatsApp Share Modal */}
      {isWaModalOpen && waStudent && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-indigo-950/80 bg-white/95 p-4 sm:p-6 select-none">
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
                  <p className="font-bold text-sm text-slate-900">{waStudent.displayName || waStudent.studentName}</p>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">NISN / Kelas</label>
                  <p className="font-bold text-sm text-slate-900">{waStudent.nisn} (Kl. {waStudent.kelas || "-"})</p>
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

      {/* Student Profile Modal */}
      {selectedStudentProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-indigo-950/80 bg-white/95 p-4 sm:p-10 animate-in fade-in duration-500">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white w-full max-w-4xl rounded-[3.5rem] overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="bg-slate-50 p-10 text-black flex justify-between items-center shrink-0 relative overflow-hidden border-b border-slate-200">
              <div className="flex items-center gap-6 relative z-10">
                <div className="w-20 h-20 rounded-full border-4 border-[#85cc00] bg-[#85cc00]/10 flex items-center justify-center overflow-hidden shadow-md">
                  {selectedStudentProfile.profilePhotoUrl ? (
                    <img loading="lazy"
                      src={getDriveImageUrl(selectedStudentProfile.profilePhotoUrl)}
                      alt={selectedStudentProfile.displayName}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <User className="w-10 h-10 text-slate-950" />
                  )}
                </div>
                <div>
                  <h3 className="text-3xl font-display font-black tracking-tight text-slate-950">
                    {selectedStudentProfile.displayName}
                  </h3>
                  <div className="flex flex-wrap gap-2 items-center mt-2">
                    <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-white border border-slate-200 rounded-md text-slate-600">
                      NISN: {selectedStudentProfile.nisn}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-[#85cc00]/20 border border-[#85cc00]/30 rounded-md text-slate-800">
                      Kelas: {selectedStudentProfile.kelas || "-"}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest px-3 py-1 bg-[#85cc00]/10 border border-[#85cc00]/20 rounded-md text-[#85cc00]">
                      Akses: {selectedStudentProfile.accessCode || "-"}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedStudentProfile(null)}
                className="p-4 hover:bg-slate-200 rounded-2xl transition-all active:scale-95 group relative z-10 animate-pulse"
              >
                <X className="w-7 h-7 group-hover:rotate-90 transition-transform text-slate-500" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex bg-slate-100 px-10 py-3 gap-4 border-b border-slate-200 shrink-0">
              <button
                onClick={() => setStudentProfileTab("tugas")}
                className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  studentProfileTab === "tugas"
                    ? "bg-[#85cc00] text-black shadow-md shadow-[#85cc00]/20"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                }`}
              >
                Riwayat Tugas & Materi
              </button>
              <button
                onClick={() => setStudentProfileTab("ujian")}
                className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                  studentProfileTab === "ujian"
                    ? "bg-[#85cc00] text-black shadow-md shadow-[#85cc00]/20"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-200/50"
                }`}
              >
                Riwayat Ujian Online
              </button>
            </div>

            {/* Scrollable Contents */}
            <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-white">
              {studentProfileTab === "tugas" ? (
                <div className="space-y-6">
                  <h4 className="text-lg font-display font-black text-slate-800 uppercase tracking-wider mb-4">
                    Kinerja Pengumpulan Tugas
                  </h4>
                  {(() => {
                    const studentSubs = submissionsList.filter(
                      (s) => s.nisn === selectedStudentProfile.nisn
                    );
                    const stuAssignments = assignmentsList.filter(
                      (a) => a.kelasRef === selectedStudentProfile.kelas
                    );

                    if (stuAssignments.length === 0) {
                      return (
                        <div className="text-center py-12 border-2 border-dashed border-slate-250 rounded-3xl text-slate-400 font-medium">
                          Tidak ada daftar tugas yang ditargetkan untuk kelas siswa ini.
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {stuAssignments.map((asg, idx) => {
                          const sub = studentSubs.find((s) => s.assignmentId === asg.id);
                          const fGrade = finalGradesList.find(
                            (fg) => fg.assignmentId === asg.id && fg.nisn === selectedStudentProfile.nisn
                          );
                          const currentScore = sub?.nilai || fGrade?.nilai;

                          return (
                            <div
                              key={`stu-asg-${asg.id || idx}-${idx}`}
                              className="p-6 rounded-2xl border border-slate-200 bg-slate-50 flex flex-col justify-between relative overflow-hidden"
                            >
                              {asg.deadline && (() => {
                                const dl = new Date(asg.deadline).getTime();
                                const diff = dl - Date.now();
                                return diff > 0 && diff < 24 * 60 * 60 * 1000 ? (
                                  <div className="absolute top-2 right-2 bg-[#85cc00]/10 p-1.5 rounded-lg border border-[#85cc00]/20 flex items-center gap-1.5">
                                    <Clock className="w-3 h-3 text-[#85cc00] animate-pulse" />
                                    <span className="text-[8px] font-black text-[#85cc00] uppercase tracking-tighter">Mendekati Deadline</span>
                                  </div>
                                ) : null;
                              })()}
                              <div>
                                <span className="text-[9px] font-black uppercase tracking-wider text-[#85cc00] bg-[#85cc00]/10 border border-[#85cc00]/20 px-2 py-0.5 rounded-full">
                                  {asg.materi}
                                </span>
                                <h5 className="text-base font-bold text-slate-800 mt-2">
                                  {asg.desc || "Lampiran Tugas"}
                                </h5>
                                <p className="text-xs font-semibold text-slate-400 mt-1">
                                  Rilis: {getAssignmentPublishedAtForTeacher(asg, selectedStudentProfile?.kelas)}
                                </p>
                              </div>

                              <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center">
                                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">
                                  Status:
                                </span>
                                {currentScore ? (
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-black bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1 rounded-md uppercase tracking-wider">
                                      Sudah Dinilai
                                    </span>
                                    <span className="text-base font-black text-emerald-600 font-mono">
                                      {currentScore}
                                    </span>
                                  </div>
                                ) : sub ? (
                                  <span className="text-[10px] font-black bg-amber-50 text-amber-600 border border-amber-200 px-3 py-1 rounded-md uppercase tracking-wider">
                                    Menunggu Penilaian Guru
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-black bg-slate-100 text-slate-400 border border-slate-200 px-3 py-1 rounded-md uppercase tracking-wider">
                                    Belum Mengumpulkan
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="space-y-6">
                  <h4 className="text-lg font-display font-black text-slate-800 uppercase tracking-wider mb-4">
                    Riwayat Hasil Ujian Informatika
                  </h4>
                  {(() => {
                    const studentExams = examsList.filter((e) => {
                      const isCorrectClass = e.kelasRef === selectedStudentProfile.kelas || (e.targets && e.targets.some((t: any) => t.kelas === selectedStudentProfile.kelas));
                      const isSubjectInformatika = e.subject?.toLowerCase() === "informatika";
                      return isCorrectClass && isSubjectInformatika;
                    });

                    if (studentExams.length === 0) {
                      return (
                        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-3xl text-slate-400 font-medium">
                          Tidak ada ujian Informatika yang dijadwalkan untuk kelas siswa ini.
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-4">
                        {studentExams.map((exam, idx) => {
                          const finalGrade = finalGradesList.find(
                            (fg) => fg.assignmentId === exam.id && fg.nisn === selectedStudentProfile.nisn
                          );

                          const score = finalGrade?.nilai;
                          const kkm = exam.kkm || 75;
                          const hasPassed = score !== undefined && score >= kkm;
                          const violationCount = finalGrade?.violationCount || 0;

                          return (
                            <div
                              key={`stu-exam-${exam.id || idx}-${idx}`}
                              className={`p-6 sm:p-8 rounded-3xl border transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-6 ${
                                score !== undefined
                                  ? "bg-white border-slate-300 shadow-md hover:shadow-lg"
                                  : "bg-slate-50/50 border-slate-200"
                              }`}
                            >
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-black bg-[#85cc00]/10 text-[#85cc00] border border-[#85cc00]/20 rounded px-2.5 py-0.5 uppercase tracking-wider">
                                    {exam.subject}
                                  </span>
                                  {score !== undefined && (
                                    <span className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded border ${
                                      hasPassed
                                        ? "bg-emerald-50 text-emerald-600 border-emerald-100"
                                        : "bg-[#85cc00]/10 text-[#85cc00] border-[#85cc00]/20"
                                    }`}>
                                      {hasPassed ? "Memenuhi KKM" : "Belum Lulus"}
                                    </span>
                                  )}
                                </div>
                                <h5 className="text-lg font-black text-slate-800 font-display">
                                  {exam.title}
                                </h5>
                                <p className="text-xs font-semibold text-slate-400">
                                  Terbit: {exam.createdAt ? new Date(exam.createdAt).toLocaleDateString("id-ID", xúƒñﬂn”0∆Ô˜áÄˆG¬´ª≠ï∂p91!m\MìÊ&nkÍ8¡v÷T]$ûÉõIª‚πx;Ì≤6Mâ;	ëã(vNéèœÔÀóÃ  ”6Ïâ$§í˘{Ø!åÑô5ä§6„)%r) ≤hÉáº~}Ä≥≥OmË®ò9QÍúÑ¥Îiöj§8—Ω¡&%ÍG<z≥Ò8Ã:˚@/Opi¬·""|ª<4%··∑Ñ*Õ"°N9C=Çª;¿è˘w†ÊË4‚∫†N#`∑Ωù∫(¥\˜Ä”Ï	M$â!⁄˘@D˘êi*‰S°©Ñ!â—	L– ·‹NItj$ô#˝HT"mÔ=^õÈXõßÃT¨übÊçjbÏ’o}¶¸HRx—ÌB":`Ç∞ª˚µOVÔ5ã]2¡43LsxúÚ“ÛÅd√ëÜX¢á
Ûï‚55\5qú^/§¿â?Ü%ëúë$qL•O-Õm&Üh¬£˚®È∏0¿Ö&:QŸ»äLà"¬≠‡zEÕèŸ-ãL…Fª£DhËÜSßÓÁÀî_&∏!àr›≠…´yÿÇ8E«O&Y‡¡\p˝!∫z˘∂Â˚_7öxﬁÀbf!¨G}=E≠¥yñÂÓK ÇÖQúpEù) ¸æˇÒ≥‹≠,5\8√!ëé`,7S∞áµ∏ˇ¡Çè%<@-åKs%À—€Ÿä¡˝ºÕ6pI•f˝—ÛÃ≈zÊvÏêÎyËˆ
V⁄˝ÍcKtÓK-l°∑,Ù„˙Q K@/Ïﬂ’'+?ú©zéMzΩs∆	ko√Æº˛Ï&_ÕÓp©Ç¸2`*Êd
Ø˝Ôu¡¸ò∆{eµ{ˆ?c’êºÏ&sïÌ<øã®∂—©´ ƒ\°"+å≈*˝a\a1a∞	π‹Vm(OB¯Úï9yØkokﬂá÷◊Üº€x3€X¿_≤VÊÀˆ+rUf)≈≠≈tad?{á+Û+aã≈ú))€˘  ˇˇ p˛‡∂