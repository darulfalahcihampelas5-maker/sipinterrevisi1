import express from "express";
// Process-level robust crash prevention
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process Server] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process Server] Uncaught Exception thrown:", error);
});

import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import multer from 'multer';

initializeApp({
  storageBucket: "gen-lang-client-0391947162.firebasestorage.app"
});
const db = getFirestore();
const bucket = getStorage().bucket();
const upload = multer({ storage: multer.memoryStorage() });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateContentWithFallback(params: {
  contents: any;
  config?: any;
}) {
  // Use gemini-3.6-flash as default, fallback to gemini-3.1-flash-lite if rate-limited or busy
  const models = ["gemini-3.6-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  for (const model of models) {
    try {
      console.log(`[Gemini Engine] Attempting generation with model: ${model}`);
      const response = await ai.models.generateContent({
        model: model,
        contents: params.contents,
        config: params.config,
      });
      if (response && response.text) {
        console.log(`[Gemini Engine] Success using model: ${model}`);
        return response;
      }
      throw new Error(`Model ${model} returned empty response.`);
    } catch (error: any) {
      console.warn(`[Gemini Engine] Failed using model: ${model}. Error: ${error.message || JSON.stringify(error)}`);
      lastError = error;
    }
  }

  const cleanErrorMessage = lastError && lastError.message 
    ? lastError.message 
    : "Kedua model Gemini (3.6-flash & 3.1-flash-lite) mengalami gangguan atau limit kuota.";
  throw new Error(cleanErrorMessage);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for Gemini Title Generation
  app.post("/api/generate-title", async (req, res) => {
    try {
      const { bab } = req.body;
      if (!bab) {
        return res.status(400).json({ error: "Bab is required" });
      }

      const prompt = `Berikan satu judul materi pelajaran yang menarik, profesional, dan sangat relevan untuk bab pelajaran berikut: "${bab}". Berikan HANYA judulnya saja tanpa tanda kutip, tanpa penjelasan tambahan, dan maksimal 10 kata.`;
      
      const response = await generateContentWithFallback({
          contents: prompt,
      });

      const title = response.text ? response.text.trim() : "";
      
      res.json({ title: title.replace(/^"|"$/g, '') });
    } catch (error) {
      console.error("Error generating title:", error);
      res.status(500).json({ error: "Failed to generate title" });
    }
  });

  // API Route for Gemini Exam Generation with structured output
  app.post("/api/generate-exam", upload.single("document"), async (req, res) => {
    try {
      const { subject, bab, count, tema, materi, description, pastedText } = req.body;
      if (!subject || !bab) {
        return res.status(400).json({ error: "Mata pelajaran dan Bab wajib diisi" });
      }

      const questionCount = Number(count) || 5;
      let prompt = "";

      if (pastedText && pastedText.trim()) {
        prompt = `Konversikan teks butir soal/materi kuis berikut (yang disalin dari NotebookLM atau sumber AI lainnya) menjadi tepat ${questionCount} soal pilihan ganda terstruktur dalam bahasa Indonesia untuk mata pelajaran "${subject}" dengan bahasan Bab: "${bab}".

Teks Referensi Soal/Kuis:
---
${pastedText}
---

Instruksi Tambahan:
1. Ekstrak pertanyaan, pilihan opsi, dan kunci jawaban dari teks di atas secara akurat.
2. Setiap soal wajib memiliki tepat 5 opsi pilihan jawaban (A, B, C, D, E) yang bersih, profesional, dan masuk akal.
3. Jika teks referensi tidak memiliki opsi jawaban lengkap, buatkan opsi tambahan yang logis.
4. Tentukan kunci jawaban yang benar dan set correctIndex (0 = A, 1 = B, 2 = C, 3 = D, 4 = E).`;
      } else {
        prompt = `Buatlah ${questionCount} soal pilihan ganda berkualitas tinggi (berstandar AKM/UTBK jika relevan) dalam bahasa Indonesia untuk mata pelajaran "${subject}" dengan bahasan Bab: "${bab}"`;
        
        if (tema) {
          prompt += `, kategori/jenis ujian: "${tema}"`;
        }
        
        if (materi) {
          prompt += `, cakupan materi spesifik (sub bab): "${materi}"`;
        }

        if (description) {
          prompt += `, deskripsi/instruksi tambahan khusus untuk soal: "${description}"`;
        }
        
        prompt += `. Setiap soal harus memiliki tepat 5 pilihan opsi (jawaban A, B, C, D, E) yang masuk akal. Tentukan index jawaban yang benar pada correctIndex (0 untuk opsi pertama, 1 untuk opsi kedua, dst, maksimal 4).`;
      }

      const parts: any[] = [];
      if (req.file) {
        parts.push({
          inlineData: {
            data: req.file.buffer.toString("base64"),
            mimeType: req.file.mimetype
          }
        });
        prompt += `\nGunakan dokumen yang dilampirkan sebagai sumber referensi utama dalam pembuatan soal ujian ini.`;
      }
      parts.push({ text: prompt });

      const response = await generateContentWithFallback({
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            description: "Daftar pertanyaan ujian pilihan ganda",
            items: {
              type: Type.OBJECT,
              properties: {
                text: {
                  type: Type.STRING,
                  description: "Teks pertanyaan ujian kompetensi"
                },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Tepat 5 pilihan opsi jawaban (A, B, C, D, E)"
                },
                correctIndex: {
                  type: Type.INTEGER,
                  description: "Index pilihan jawaban yang benar (rentang 0 sampai 4)"
                }
              },
              required: ["text", "options", "correctIndex"]
            }
          }
        }
      });

      const responseText = response.text ? response.text.trim() : "[]";
      const questions = JSON.parse(responseText);
      res.json({ questions });
    } catch (error: any) {
      console.error("Error generating exam questions:", error);
      res.status(500).json({ 
        error: "Gagal membuat soal ujian menggunakan AI.", 
        details: error.message || String(error),
        stack: error.stack
      });
    }
  });

  // API Route for Student Ranking
  app.get("/api/student-ranking", async (req, res) => {
    try {
      const classId = req.query.classId as string;
      if (!classId) {
        return res.status(400).json({ error: "Class ID is required" });
      }

      const studentsSnapshot = await db.collection("studentsByNisn").where("classId", "==", classId).get();
      const attendanceSnapshot = await db.collection("absensi").get();
      const submissionsSnapshot = await db.collection("submissions").get();

      const studentScores: any[] = [];

      studentsSnapshot.forEach((doc) => {
        const student = doc.data();
        const nisn = student.nisn;

        // Calculate attendance (e.g., count of "Hadir")
        const attendanceCount = attendanceSnapshot.docs.filter(a => a.data().nisn === nisn && a.data().status === "Hadir").length;

        // Calculate on-time submissions (assuming a property "isLate" or comparison)
        const onTimeSubmissions = submissionsSnapshot.docs.filter(s => s.data().nisn === nisn && !s.data().isLate).length;

        // Simple score: attendance * 0.6 + submissions * 0.4 (weighted)
        const score = (attendanceCount * 0.6) + (onTimeSubmissions * 0.4);

        studentScores.push({ nisn: nisn, name: student.name, score });
      });

      // Sort by score
      studentScores.sort((a, b) => b.score - a.score);

      res.json({ ranking: studentScores });
    } catch (error) {
      console.error("Error calculating ranking:", error);
      res.status(500).json({ error: "Failed to calculate ranking" });
    }
  });

  // API Route to check link accessibility for Google Drive, CamScanner, Canva, OneDrive, Dropbox, & general URLs
  app.post("/api/check-drive-access", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ isDrive: false, accessible: false, provider: "unknown", providerName: "Link", message: "URL tidak valid" });
      }

      const trimmedUrl = url.trim();
      if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
        return res.status(400).json({ isDrive: false, accessible: false, provider: "invalid", providerName: "Link", message: "URL harus diawali dengan http:// atau https://" });
      }

      // Detect provider type
      const isGoogleDrive = /drive\.google\.com|docs\.google\.com/i.test(trimmedUrl);
      const isCamScanner = /camscanner\.com|cs\.co/i.test(trimmedUrl);
      const isCanva = /canva\.com/i.test(trimmedUrl);
      const isOneDrive = /onedrive\.live\.com|1drv\.ms|sharepoint\.com/i.test(trimmedUrl);
      const isDropbox = /dropbox\.com/i.test(trimmedUrl);

      let provider = "general";
      let providerName = "Tautan Web / File";

      if (isGoogleDrive) {
        provider = "google_drive";
        providerName = "Google Drive";
      } else if (isCamScanner) {
        provider = "camscanner";
        providerName = "CamScanner";
      } else if (isCanva) {
        provider = "canva";
        providerName = "Canva";
      } else if (isOneDrive) {
        provider = "onedrive";
        providerName = "OneDrive";
      } else if (isDropbox) {
        provider = "dropbox";
        providerName = "Dropbox";
      }

      // If Google Drive, perform deep restricted check
      if (isGoogleDrive) {
        let fileId = "";
        const driveFileMatch = trimmedUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        const docsMatch = trimmedUrl.match(/\/(document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
        const folderMatch = trimmedUrl.match(/\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/);
        const openIdMatch = trimmedUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);

        if (driveFileMatch && driveFileMatch[1]) {
          fileId = driveFileMatch[1];
        } else if (docsMatch && docsMatch[2]) {
          fileId = docsMatch[2];
        } else if (folderMatch && folderMatch[1]) {
          fileId = folderMatch[1];
        } else if (openIdMatch && openIdMatch[1]) {
          fileId = openIdMatch[1];
        }

        if (!fileId) {
          return res.json({ isDrive: true, provider, providerName, accessible: true, message: "Link Google Drive terdeteksi" });
        }

        const checkUrls = [
          `https://drive.google.com/file/d/${fileId}/view`,
          `https://lh3.googleusercontent.com/d/${fileId}=w200`,
          `https://drive.google.com/drive/folders/${fileId}`
        ];

        let isRestricted = false;
        let isNotFound = false;

        for (const testUrl of checkUrls) {
          try {
            const response = await fetch(testUrl, {
              method: "GET",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              },
              redirect: "follow",
            });

            const finalUrl = response.url;
            
            if (response.status === 404) {
              isNotFound = true;
              continue;
            }

            if (
              response.status === 403 ||
              response.status === 401 ||
              finalUrl.includes("accounts.google.com") ||
              finalUrl.includes("ServiceLogin")
            ) {
              isRestricted = true;
              break;
            }

            const bodyText = await response.text();
            if (
              bodyText.includes("Anda memerlukan akses") ||
              bodyText.includes("You need access") ||
              bodyText.includes("request-access") ||
              bodyText.includes("access-denied") ||
              bodyText.includes("denied")
            ) {
              isRestricted = true;
              break;
            }

            if (response.status === 200 && !finalUrl.includes("accounts.google.com")) {
              return res.json({
                isDrive: true,
                provider,
                providerName,
                accessible: true,
                message: "Link Publik: Dapat diakses & dinilai oleh Guru.",
              });
            }
          } catch (err) {
            console.warn("Drive check fetch error:", err);
          }
        }

        if (isRestricted) {
          return res.json({
            isDrive: true,
            provider,
            providerName,
            accessible: false,
            message: "Link Google Drive Dibatasi (Restricted). Akses belum diubah ke 'Siapa saja yang memiliki link'.",
          });
        }

        if (isNotFound) {
          return res.json({
            isDrive: true,
            provider,
            providerName,
            accessible: false,
            message: "File / Folder Google Drive tidak ditemukan atau sudah dihapus.",
          });
        }

        return res.json({ isDrive: true, provider, providerName, accessible: true, message: "Link Google Drive terdeteksi" });
      }

      // For CamScanner, Canva, OneDrive, Dropbox, or General URLs
      try {
        const response = await fetch(trimmedUrl, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          redirect: "follow",
        });

        if (response.status >= 200 && response.status < 400) {
          return res.json({
            isDrive: false,
            provider,
            providerName,
            accessible: true,
            message: `Link ${providerName} Valid & Dapat Diakses Guru.`,
          });
        } else if (response.status === 404) {
          return res.json({
            isDrive: false,
            provider,
            providerName,
            accessible: false,
            message: `Halaman/File ${providerName} tidak ditemukan (404). Mohon periksa kembali link Anda.`,
          });
        } else {
          // Keep accessible true for special web apps that block automated scraping but work in browser
          return res.json({
            isDrive: false,
            provider,
            providerName,
            accessible: true,
            message: `Link ${providerName} terdeteksi dan siap dikumpulkan.`,
          });
        }
      } catch (e) {
        // If fetch fails (e.g. CORS/network or bot blocking on backend), consider valid URL format
        return res.json({
          isDrive: false,
          provider,
          providerName,
          accessible: true,
          message: `Link ${providerName} terdeteksi dan siap dikumpulkan.`,
        });
      }
    } catch (error: any) {
      console.error("Error checking link access:", error);
      return res.status(500).json({ error: "Gagal memeriksa akses link" });
    }
  });

  // Helper function to get or create a Google Drive folder
  const getOrCreateDriveFolder = async (token: string, folderName: string, parentId?: string): Promise<string> => {
    let query = `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`;
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    }
    
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    
    if (!searchRes.ok) {
      const err = await searchRes.text();
      if (searchRes.status === 401) {
        throw new Error("UNAUTHENTICATED: Sesi Google Drive kedaluwarsa.");
      }
      throw new Error(`Failed to search folder ${folderName}: ${err}`);
    }
    
    const searchData = await searchRes.json() as any;
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
    
    // Create folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined
      })
    });
    
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create folder ${folderName}: ${err}`);
    }
    
    const createData = await createRes.json() as any;
    return createData.id;
  };

  // API Route for File Upload with Multer error handling
  app.post("/api/upload", (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Kesalahan Unggah: ${err.message}` });
      } else if (err) {
        return res.status(500).json({ error: `Kesalahan Server: ${err.message}` });
      }
      next();
    });
  }, async (req: any, res: any) => {
    console.log("[Upload] Route reached. File:", req.file?.originalname);
    try {
      if (!req.file) {
          console.log("[Upload] No file in request");
          return res.status(400).json({ error: "File tidak ditemukan dalam permintaan" });
      }
      const token = req.body.token;
      if (!token) {
          console.log("[Upload] No token provided");
          return res.status(401).json({ error: "Sesi Google Drive tidak valid" });
      }

      console.log(`[Upload] Processing ${req.file.originalname} (${req.file.size} bytes)`);
      
      // Upload to Google Drive using multipart/related
      const metadata: any = {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
      };

      try {
        console.log("[Upload] Getting or creating main folder...");
        const mainFolderName = "TUGAS INFORMATIKA GANJIL";
        const mainFolderId = await getOrCreateDriveFolder(token, mainFolderName);
        let parentFolderId = mainFolderId;
        
        const studentName = req.body.studentName;
        if (studentName) {
          console.log(`[Upload] Getting or creating student folder: ${studentName}...`);
          const studentFolderId = await getOrCreateDriveFolder(token, studentName, mainFolderId);
          parentFolderId = studentFolderId;
        }
        metadata.parents = [parentFolderId];
      } catch (err: any) {
        console.error("[Upload] Error creating folders:", err);
        if (err.message.includes("UNAUTHENTICATED")) {
          return res.status(401).json({ error: "Sesi Google Drive kedaluwarsa. Silakan hubungkan ulang." });
        }
        // For other folder errors, we can continue to upload to root as fallback, 
        // or we could choose to fail. Let's just log and continue for now for non-auth errors.
      }

      const boundary = '-------314159265358979323846';
      const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
      const filePart = `--${boundary}\r\nContent-Type: ${req.file.mimetype}\r\n\r\n`;
      const endPart = `\r\n--${boundary}--\r\n`;

      const body = Buffer.concat([
        Buffer.from(metadataPart),
        Buffer.from(filePart),
        req.file.buffer,
        Buffer.from(endPart)
      ]);

      console.log("[Upload] Sending request to Google API...");
      const driveRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': `${body.length}`
        },
        body: body,
        // Add a signal/timeout if needed (Node 18+ fetch supports signal)
      });

      if (!driveRes.ok) {
        const errorText = await driveRes.text();
        console.error("[Upload] Drive API error:", errorText);
        let driveError = "Gagal mengunggah ke Google Drive";
        try {
          const driveErrJson = JSON.parse(errorText);
          driveError = driveErrJson.error?.message || driveError;
        } catch (e) {}
        return res.status(driveRes.status).json({ error: driveError });
      }

      const data = await driveRes.json() as any;
      const fileId = data.id;
      const webViewLink = data.webViewLink;

      console.log(`[Upload] File uploaded successfully. ID: ${fileId}`);

      // Make the file public (Anyone with link can view)
      console.log("[Upload] Setting file permissions...");
      const permRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      });

      if (!permRes.ok) {
        console.warn("[Upload] Warning: Failed to set public permissions, but file was uploaded.");
      }

      console.log("[Upload] All steps completed.");
      res.json({ webViewLink });
    } catch (error: any) {
      console.error("[Upload] Critical error:", error.message, error.stack);
      res.status(500).json({ error: "Sistem gagal memproses unggahan: " + error.message });
    }
  });

  // API Route to proxy images (to bypass CORS)
  app.get("/api/proxy-image", async (req, res) => {
    try {
      let imageUrl = req.query.url as string;
      if (!imageUrl) {
        return res.status(400).send("URL is required");
      }
      
      // Auto-convert Google Drive links to direct lh3 usercontent URLs
      if (imageUrl.includes("drive.google.com") || imageUrl.includes("googleusercontent.com")) {
        const fileIdMatch = imageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || imageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (fileIdMatch && fileIdMatch[1]) {
          imageUrl = `https://lh3.googleusercontent.com/d/${fileIdMatch[1]}`;
        }
      }
      
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type") || "image/png";
      
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.send(Buffer.from(buffer));
    } catch (error: any) {
      console.error("Proxy image error:", error);
      res.status(500).send(error.message);
    }
  });

  // Handle 404 for API routes
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Global Error Handler:", err);
    if (res.headersSent) {
      return next(err);
    }
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ 
      error: err.message || "Terjadi kesalahan internal pada server",
      status
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
