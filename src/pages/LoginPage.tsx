import { useState, useEffect } from "react";
import { db } from "../lib/firebase";
import { doc, getDoc, collection, query, where, getDocs, setDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { OperationType, handleFirestoreError } from "../lib/firestoreUtils";
import { getDriveImageUrl } from "../lib/driveUtils";
import { NotificationModal } from "../components/NotificationModal";
import { motion, AnimatePresence } from "motion/react";
import {
  GraduationCap,
  ShieldCheck,
  User,
  LogIn,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Fingerprint,
  Sparkles,
  ArrowRight,
  Eye,
  EyeOff,
  X,
  Info,
  RefreshCw,
  Download,
  Smartphone,
  Monitor,
  Share2,
  Plus,
  ExternalLink,
} from "lucide-react";

export default function LoginPage() {
  const navigate = useNavigate();

  // Splash Screen State
  const [showSplash, setShowSplash] = useState(() => {
    return sessionStorage.getItem("splashShown") === "true" ? false : true;
  });

  useEffect(() => {
    if (sessionStorage.getItem("splashShown") === "true") {
      setShowSplash(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowSplash(false);
      sessionStorage.setItem("splashShown", "true");
    }, 2500);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  // Auto-login if student session exists in localStorage (waits for splash screen to complete)
  useEffect(() => {
    if (showSplash) return;
    try {
      const savedStudent = localStorage.getItem("current_student");
      if (savedStudent) {
        const studentObj = JSON.parse(savedStudent);
        if (studentObj && (studentObj.nisn || studentObj.id)) {
          navigate("/dashboard/student", { state: { student: studentObj }, replace: true });
        }
      }
    } catch (e) {
      console.warn("Error parsing saved student session:", e);
    }
  }, [showSplash, navigate]);

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

  const [activeTab, setActiveTab] = useState<"siswa" | "guru">("siswa");
  const [nisn, setNisn] = useState("");
  const [studentAccessCode, setStudentAccessCode] = useState("");
  const [student, setStudent] = useState<any>(null);
  const [nisnError, setNisnError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [direction, setDirection] = useState(0);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showStudentAccessCode, setShowStudentAccessCode] = useState(false);

  // States for interactive help modals mimicking screenshot links
  const [showRegisterHelp, setShowRegisterHelp] = useState(false);
  const [showForgotHelp, setShowForgotHelp] = useState(false);

  const handleTabChange = (tab: "siswa" | "guru") => {
    if (tab === activeTab) return;
    setDirection(tab === "guru" ? 1 : -1);
    setActiveTab(tab);
    setNisn("");
    setStudentAccessCode("");
    setStudent(null);
  };

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? "100%" : "-100%",
      opacity: 0,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? "100%" : "-100%",
      opacity: 0,
    }),
  };

  const springConfig = {
    type: "spring" as const,
    stiffness: 180,
    damping: 24,
    mass: 1,
  };

  const [dbTeacherPassword, setDbTeacherPassword] = useState<string | null>(() => {
    return localStorage.getItem("teacher_password") || null;
  });

  const handleTeacherLogin = async () => {
    setIsLoading(true);
    setNisnError("");
    try {
      // Artificial delay for premium feel
      await new Promise((resolve) => setTimeout(resolve, 500));

      const cleanUser = username.trim().toLowerCase();
      const cleanPass = password.trim();

      let storedPass = dbTeacherPassword || localStorage.getItem("teacher_password");
      
      // If not in cache, fetch once on demand
      if (!storedPass) {
        try {
          const docSnap = await getDoc(doc(db, "config", "teacher_auth"));
          if (docSnap.exists() && docSnap.data()?.password) {
            storedPass = docSnap.data().password;
            setDbTeacherPassword(storedPass);
            if (storedPass) localStorage.setItem("teacher_password", storedPass);
          }
        } catch (e) {
          console.warn("Could not fetch teacher_auth:", e);
        }
      }

      const validUsers = ["admin", "agan", "agan121", "agan121@guru.sma.belajar.id"];
      const defaultPasses = ["admin", "guru", "pinter", "123456"];

      const isUserValid = validUsers.includes(cleanUser);
      const isPassValid = storedPass ? cleanPass === storedPass : defaultPasses.includes(cleanPass);

      if (isUserValid && isPassValid) {
        sessionStorage.setItem("is_teacher_auth", "true");
        localStorage.setItem("is_teacher_auth", "true");
        navigate("/dashboard/teacher", { replace: true });
      } else if (!cleanUser || !cleanPass) {
        setNisnError("Silakan masukkan Username dan Password Guru.");
      } else {
        setNisnError("Kredensial tidak valid. Periksa kembali Username dan Password Anda.");
      }
    } catch (e) {
      setNisnError("Terjadi kesalahan sistem saat masuk.");
    } finally {
      setIsLoading(false);
    }
  };

  const checkNisn = async () => {
    if (!studentAccessCode.trim()) {
      setNisnError("Silakan masukkan Kode Akses terlebih dahulu.");
      return;
    }
    setNisnError("");
    setIsLoading(true);

    try {
      const inputCode = studentAccessCode.toString().trim().toLowerCase();

      // 1. Check direct fallback credentials first to ensure instant login under any conditions (e.g. offline, initial seed delay)
      if (inputCode === "siswa2026") {
        const fallbackStudent = {
          id: "123456789",
          nisn: "123456789",
          displayName: "Budi Santoso",
          kelas: "XI-MIPA-1",
          classId: "XI-MIPA-1",
          accessCode: "SISWA2026",
          role: "student",
          alamat: "Jl. Raya Cililin No. 12",
          jenisKelamin: "Laki-laki",
          agama: "Islam",
          kewarganegaraan: "WNI",
          tempatLahir: "Bandung",
          tanggalLahir: "2008-04-15",
          hobi: "Membaca, Pemrograman, Basket",
          citaCita: "Arsitek Cloud",
          motto: "Belajar hari ini, memimpin hari esok."
        };
        setStudent(fallbackStudent);
        setIsLoading(false);
        return;
      }

      // Check local cache if student logged in recently
      const savedStudent = localStorage.getItem("current_student");
      if (savedStudent) {
        try {
          const parsed = JSON.parse(savedStudent);
          if (parsed && parsed.accessCode && parsed.accessCode.toString().trim().toLowerCase() === inputCode) {
            setStudent(parsed);
            setIsLoading(false);
            return;
          }
        } catch (_) {}
      }

      // 2. Single targeted query first to minimize Firestore reads
      const fetchStudentPromise = async () => {
        const studentsRef = collection(db, "studentsByNisn");
        const rawCode = studentAccessCode.toString().trim();
        
        // Single query with exact/case-insensitive fallback
        const qSnap = await getDocs(query(studentsRef, where("accessCode", "==", rawCode)));
        if (!qSnap.empty) {
          const docDoc = qSnap.docs[0];
          return { id: docDoc.id, ...docDoc.data() };
        }
        
        // If not found and input wasn't uppercase, try uppercase
        if (rawCode.toUpperCase() !== rawCode) {
          const qSnapUpper = await getDocs(query(studentsRef, where("accessCode", "==", rawCode.toUpperCase())));
          if (!qSnapUpper.empty) {
            const docDoc = qSnapUpper.docs[0];
            return { id: docDoc.id, ...docDoc.data() };
          }
        }

        return null;
      };

      // Set a 12 seconds timeout to prevent premature timeout on slow connections or database cold starts
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("TIMEOUT")), 12000)
      );

      const foundStudentData = await Promise.race([
        fetchStudentPromise(),
        timeoutPromise
      ]);

      if (foundStudentData) {
        setStudent(foundStudentData);
        safeSaveStudentToLocalStorage(foundStudentData);
      } else {
        setNisnError("Kode Akses yang Anda masukkan salah atau belum terdaftar.");
      }
    } catch (error: any) {
      if (error.message === "TIMEOUT") {
        setNisnError("Koneksi ke server lambat atau terputus. Silakan coba lagi.");
      } else if (error.message && (error.message.toLowerCase().includes("quota") || error.message.toLowerCase().includes("resource-exhausted"))) {
        const quotaMsg = "Kuota server harian (Firebase) telah habis. Aplikasi dapat digunakan kembali pada pukul 14.00 WIB atau jam 2 siang.";
        setNisnError("");
        showAlert("Batas Kuota Harian Habis", quotaMsg, "alert");
      } else {
        setNisnError(`Terjadi kesalahan sistem saat verifikasi. (${error.message})`);
        try {
          handleFirestoreError(error, OperationType.GET, "studentsByNisn/searchByAccessCode");
        } catch (_) {}
      }
    } finally {
      setIsLoading(false);
    }
  };

  const safeSaveStudentToLocalStorage = (st: any) => {
    if (!st || typeof st !== "object") return;
    try {
      const isEventObj = "nativeEvent" in st || "preventDefault" in st || "_reactName" in st;
      if (isEventObj) return;

      const stCopy = { ...st };
      if (stCopy.profilePhotoUrl && stCopy.profilePhotoUrl.length > 10000 && stCopy.profilePhotoUrl.startsWith("data:")) {
        stCopy.profilePhotoUrl = "";
      }
      localStorage.setItem("current_student", JSON.stringify(stCopy));
    } catch (e) {
      console.warn("Gagal menyimpan sesi siswa ke localStorage:", e);
    }
  };

  const handleStudentLogin = (stData?: any) => {
    try {
      const isEventObj = stData && typeof stData === "object" && ("nativeEvent" in stData || "preventDefault" in stData || "_reactName" in stData);
      const target = isEventObj ? student : (stData || student);
      if (target) {
        safeSaveStudentToLocalStorage(target);
        navigate("/dashboard/student", { state: { student: target }, replace: true });
      }
    } catch (err) {
      console.warn("Gagal melakukan login siswa:", err);
    }
  };

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#85cc00] font-sans p-6 overflow-hidden">
        <div className="relative z-10 flex flex-col items-center max-w-md text-center">
          {/* Logo container with luxurious scale-in & pulse animation */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-28 h-28 md:w-32 md:h-32 flex items-center justify-center shrink-0 mb-8"
          >
            <img 
              src={getDriveImageUrl("https://drive.google.com/file/d/1P395tuZymxs3qero4XduMpHy7g2GJrdR/view?usp=sharing")}
              alt="Logo SiPinter"
              className="w-full h-full object-contain drop-shadow-xl"
              referrerPolicy="no-referrer"
            />
          </motion.div>

          {/* Application Name and description with staggered entry */}
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.6 }}
            className="text-3xl sm:text-4xl font-display font-black text-white tracking-tight leading-tight mb-2"
          >
            SiPinter Apps
          </motion.h1>

          <motion.p
            initial={{ y: 15, opacity: 0 }}
            animate={{ y: 0, opacity: 0.9 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-[10px] sm:text-[11px] font-bold text-white/90 tracking-widest uppercase mb-6"
          >
            Cerdas Inovatif Terampil Responsif Agamis
          </motion.p>

          <motion.p
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-sm font-medium text-white/80 max-w-sm mb-10 leading-relaxed"
          >
            Sistem Informasi Penilaian Interaktif dan Tugas Evaluasi Rutin Siswa SMAN 1 Cililin
          </motion.p>

          {/* Premium Progress Bar */}
          <div className="w-48 h-1 bg-white/30 rounded-full overflow-hidden relative shadow-inner">
            <motion.div
              initial={{ left: "-100%" }}
              animate={{ left: "100%" }}
              transition={{
                repeat: Infinity,
                duration: 1.5,
                ease: "easeInOut"
              }}
              className="absolute top-0 bottom-0 w-1/2 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,0.8)]"
            />
          </div>
          
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.4 }}
            className="text-[10px] font-bold text-white/70 tracking-wider uppercase mt-3"
          >
            Menyiapkan Aplikasi...
          </motion.span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full flex-1 flex flex-col lg:items-center lg:justify-center bg-slate-50/50 selection:bg-[#85cc00]/20 selection:text-slate-800 font-sans p-3 xs:p-4 sm:p-6 lg:p-12 xl:p-16 overflow-x-hidden">
      <NotificationModal
        {...modalConfig}
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
      />
      {/* Refined Ambient Glows */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#85cc00]/5 blur-[120px]"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/5 blur-[120px]"></div>
      </div>

      <div className="w-full max-w-6xl mx-auto flex flex-col lg:items-center lg:justify-center relative z-10">
        
        {/* Main Columns Container */}
        <div className="w-full flex flex-col lg:flex-row items-center justify-center gap-6 lg:gap-16 pt-4 pb-12 lg:py-16">
          
          {/* Branding Content */}
          <section className="w-full max-w-[500px] text-center lg:text-left flex flex-col items-center lg:items-start select-none py-2 px-4">

            <h1 className="text-4xl lg:text-5xl font-display font-black text-[#85cc00] tracking-tight leading-tight mb-3 select-none">
              SiPinter Apps
            </h1>
            
            <div className="flex flex-row items-center justify-center lg:justify-start gap-2 mb-6 opacity-95 select-none flex-wrap w-full max-w-full">
              <span className="text-[10px] sm:text-[11px] font-bold text-[#649c00] tracking-widest uppercase text-center lg:text-left">Cerdas Inovatif Terampil Responsif Agamis</span>
            </div>

            <h2 className="text-xl sm:text-2xl font-display font-semibold text-slate-700 leading-snug mb-5 max-w-[480px]">
              Sistem Informasi Penilaian Interaktif dan Tugas Evaluasi Rutin Siswa
            </h2>
            
            <p className="text-slate-500 font-normal text-sm leading-relaxed max-w-[480px] mb-6">
              Platform manajemen akademis yang akurat, real-time, dan terintegrasi untuk membangun kultur pembelajaran yang transparan dan disiplin di SMAN 1 Cililin.
            </p>




          </section>

          {/* Login Card Container */}
          <section className="w-full max-w-[440px] lg:shrink-0 px-2 sm:px-0 flex flex-col gap-4">

            <div className="bg-white rounded-[1.75rem] sm:rounded-[2rem] shadow-xl shadow-slate-100/80 border border-slate-200/60 p-5 sm:p-10 relative overflow-hidden transition-all duration-300 group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#85cc00]/80 to-emerald-500/80"></div>
              
              <div className="absolute top-10 right-10 opacity-[0.03] pointer-events-none group-hover:scale-110 transition-transform duration-700">
                <Fingerprint className="w-20 h-20 text-slate-900" />
              </div>

              {/* Login Header */}
              <div className="mb-6 text-center sm:text-left">
                <h3 className="text-slate-800 font-display font-semibold text-2xl tracking-tight mb-1">
                  Portal Masuk
                </h3>
                <p className="text-slate-400 text-xs font-normal">
                  Masukkan kredensial Anda untuk melanjutkan ke sistem
                </p>
              </div>

              {/* Tab Content Panels */}
              <div className="relative overflow-hidden min-h-[280px]">
                <AnimatePresence initial={false} custom={direction} mode="popLayout">
                  <motion.div
                    key={activeTab}
                    custom={direction}
                    variants={variants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: springConfig,
                      opacity: { duration: 0.25 },
                    }}
                    className="w-full"
                  >
                    {activeTab === "siswa" ? (
                      <div>
                        {!student ? (
                          <div className="space-y-5">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                                KODE AKSES SISWA
                              </label>
                              <div className="relative flex items-center bg-white border border-slate-300 rounded-lg px-4 py-3 focus-within:border-[#85cc00] focus-within:ring-2 focus-within:ring-[#85cc00]/20 transition-all duration-200">
                                <KeyRound className="h-4 w-4 text-slate-400 mr-3 shrink-0" />
                                <input
                                  type={showStudentAccessCode ? "text" : "password"}
                                  placeholder="CONTOH:IF1234567"
                                  value={studentAccessCode}
                                  onChange={(e) => setStudentAccessCode(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      checkNisn();
                                    }
                                  }}
                                  className="w-full bg-transparent text-slate-700 font-medium focus:outline-none placeholder:text-slate-400/70 text-base font-sans tracking-tight"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowStudentAccessCode(!showStudentAccessCode)}
                                  className="text-slate-400 hover:text-[#649c00] transition-colors shrink-0 cursor-pointer ml-2"
                                >
                                  {showStudentAccessCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                              </div>
                            </div>

                            {nisnError && (
                              <div className="p-3 bg-rose-50 border border-rose-100 rounded-md flex gap-3 items-center animate-in fade-in slide-in-from-top-2">
                                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                                <p className="text-xs font-medium text-rose-650 leading-tight">
                                  {nisnError}
                                </p>
                              </div>
                            )}

                            <button
                              onClick={checkNisn}
                              disabled={isLoading}
                              className="w-full py-3.5 bg-[#85cc00] hover:bg-[#7bc000] text-slate-800 font-semibold text-sm uppercase tracking-wider rounded-md transition-all shadow-md shadow-[#85cc00]/10 active:scale-98 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                            >
                              {isLoading ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <>Akses Dashboard <ArrowRight className="w-3.5 h-3.5" /></>
                              )}
                            </button>

                            <p 
                              onClick={() => setShowForgotHelp(true)}
                              className="text-slate-400 hover:text-[#649c00] font-medium text-xs text-center cursor-pointer mt-2 block hover:underline underline-offset-4 decoration-slate-200/40 transition-colors"
                            >
                              Bantuan Akses Sistem
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-6 animate-in fade-in duration-400">
                            <div className="bg-slate-50/60 rounded-md p-6 border border-slate-200/50 text-center relative">
                               <div className="absolute -top-3 -right-3 w-9 h-9 bg-[#85cc00] rounded-md flex items-center justify-center text-slate-850 shadow-md shadow-[#85cc00]/20">
                                  <CheckCircle2 className="w-5 h-5" />
                                </div>
                               <h4 className="text-[9px] font-bold text-[#649c00] uppercase tracking-wider mb-2">Verifikasi Profil Anda</h4>
                               <h3 className="text-xl font-display font-bold text-slate-800 mb-2">{student.displayName}</h3>
                               <p className="text-[10px] text-slate-400 mb-4 font-medium italic">Pastikan data di bawah ini benar sebelum masuk ke dashboard.</p>
                               <div className="grid grid-cols-2 gap-3">
                                  <div className="bg-white p-3 rounded-md border border-slate-150 shadow-sm">
                                     <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">NISN</p>
                                     <p className="text-xs font-bold text-slate-700">{student.nisn}</p>
                                  </div>
                                  <div className="bg-white p-3 rounded-md border border-slate-150 shadow-sm">
                                     <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">Kelas Akademik</p>
                                     <p className="text-xs font-bold text-slate-700">{student.kelas}</p>
                                  </div>
                               </div>
                            </div>

                            <div className="space-y-3">
                              <button
                                onClick={() => handleStudentLogin()}
                                className="w-full py-3.5 bg-[#85cc00] hover:bg-[#7bc000] text-slate-800 font-semibold text-sm uppercase tracking-wider rounded-md transition-all shadow-md active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
                              >
                                Konfirmasi & Masuk <ArrowRight className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setStudent(null)}
                                className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-slate-500 uppercase tracking-widest transition-colors cursor-pointer"
                              >
                                Batalkan Akses
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                            IDENTITAS GURU
                          </label>
                          <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-md px-4 py-3 focus-within:border-[#85cc00] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#85cc00]/5 transition-all duration-200">
                            <User className="h-4 w-4 text-slate-400 mr-3 shrink-0" />
                            <input
                              type="text"
                              placeholder="Masukkan username"
                              value={username}
                              onChange={(e) => setUsername(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleTeacherLogin();
                                }
                              }}
                              className="w-full bg-transparent text-slate-700 font-medium focus:outline-none placeholder:text-slate-400/70 text-base font-sans tracking-tight"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 ml-1">
                            KATA SANDI KEAMANAN
                          </label>
                          <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-md px-4 py-3 focus-within:border-[#85cc00] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#85cc00]/5 transition-all duration-200">
                            <ShieldCheck className="h-4 w-4 text-slate-400 mr-3 shrink-0" />
                            <input
                              type={showPassword ? "text" : "password"}
                              placeholder="••••••••"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleTeacherLogin();
                                }
                              }}
                              className="w-full bg-transparent text-slate-700 font-medium focus:outline-none placeholder:text-slate-400/70 text-base font-sans tracking-tight"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 cursor-pointer"
                            >
                              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {nisnError && (
                          <div className="p-3 bg-rose-50 border border-rose-100 rounded-md flex gap-3 items-center animate-in fade-in">
                            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                            <p className="text-xs font-medium text-rose-650 leading-tight">
                              {nisnError}
                            </p>
                          </div>
                        )}

                        <button
                          onClick={handleTeacherLogin}
                          disabled={isLoading}
                          className="w-full mt-2 py-3.5 bg-[#85cc00] hover:bg-[#7bc000] text-slate-800 font-semibold text-sm uppercase tracking-wider rounded-md transition-all shadow-md active:scale-98 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                        >
                          {isLoading ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <>Verifikasi & Masuk <ArrowRight className="w-3.5 h-3.5" /></>
                          )}
                        </button>

                        <p 
                          onClick={() => handleTabChange("siswa")}
                          className="text-slate-400 hover:text-[#649c00] font-medium text-xs text-center cursor-pointer mt-5 block hover:underline underline-offset-4 decoration-slate-200/40 transition-colors"
                        >
                          Akses Siswa
                        </p>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

            </div>


          </section>

        </div>

        {/* Footer Area */}
        <footer className="w-full border-t border-slate-200/40 mt-6 pt-6 pb-4 flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-2 mb-1 bg-transparent">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#85cc00] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#85cc00]"></span>
            </span>
            <span className="text-slate-600 font-semibold text-xs tracking-tight px-1 select-none">
              App Development by <span 
                onClick={() => handleTabChange("guru")} 
                className="text-[#649c00] hover:underline underline-offset-2 cursor-pointer"
              >Agan Parta,S.Kom.Gr</span>
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
            <span className="text-[#85cc00] font-bold">Enterprise Cloud</span>
            <div className="w-1.5 h-1.5 rounded-full bg-[#85cc00]/80"></div>
            <span>STABLE</span>
          </div>


        </footer>

      </div>

      {/* --- Help Modals (Adds delightful interactivity to mockup links) --- */}
      <AnimatePresence>
        {showForgotHelp && (
          <div className="fixed inset-0 bg-slate-100/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-md max-w-md w-full p-6 shadow-2xl border border-slate-200"
            >
              <div className="flex items-center justify-between mb-4 pb-2 border-b">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-[#649c00]" />
                  <h4 className="text-slate-800 font-bold uppercase text-xs sm:text-sm tracking-wider">Lupa Kode Akses</h4>
                </div>
                <button 
                  onClick={() => setShowForgotHelp(false)}
                  className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="space-y-4 text-xs sm:text-sm text-slate-600 font-medium leading-relaxed py-2">
                <p className="text-slate-800 font-semibold leading-snug">
                  Jika Anda terkendala masuk sistem karena lupa kode akses, silakan segera menemui Pak Agan Parta di ruangannya. Terima kasih.
                </p>
                <div className="bg-slate-50 p-3 rounded-md border border-slate-200/60 text-[10px] text-slate-400 font-mono tracking-wider space-y-1 select-none">
                  <div>SYSTEM ACCESS ASSISTANCE DIRECTORY</div>
                  <div>OFFICE: RUANG IT SMAN 1 CILILIN</div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setShowForgotHelp(false)}
                  className="px-5 py-2.5 bg-[#85cc00] hover:bg-[#7bc000] text-slate-800 font-semibold text-xs uppercase tracking-wider rounded-md transition-all shadow-md shadow-[#85cc00]/10 cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}





      </AnimatePresence>
    </div>
  );
}
