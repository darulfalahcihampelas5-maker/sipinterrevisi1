#!/bin/bash

cat << 'EOF' > update_modal.sh
#!/bin/bash

# Extract parts of DashboardStudent.tsx
awk 'NR<5747' src/pages/DashboardStudent.tsx > top.tsx
awk 'NR>5839' src/pages/DashboardStudent.tsx > bottom.tsx

# Create the new middle part
cat << 'MIDDLE_EOF' > middle.tsx
                  Upload File Tugas / Foto (Google Drive)
                </label>
                {!needsDriveAuth ? (
                  <div className="relative group">
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      capture="environment"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 p-5 text-sm font-black text-slate-900 focus:border-[#85cc00] focus:bg-white outline-none transition-all shadow-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-[#85cc00]/10 file:text-[#85cc00] hover:file:bg-[#85cc00]/20"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        setSelectedFile(file || null);
                      }}
                    />
                    <p className="mt-2 text-[10px] font-black text-slate-400 uppercase tracking-wider px-2">
                      ✓ File akan di-upload ke Google Drive Anda dan dibagikan secara otomatis ke Guru.
                    </p>
                  </div>
                ) : (
                  <div className="relative group border border-slate-200 p-5 rounded-2xl bg-slate-50 text-center">
                    <p className="text-xs font-semibold text-slate-600 mb-4">
                      Untuk mengirim tugas, hubungkan Google Drive Anda terlebih dahulu.
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        setIsDriveAuthLoading(true);
                        try {
                          await googleSignIn();
                          setNeedsDriveAuth(false);
                        } catch (err) {
                          console.error("Failed to sign in", err);
                        } finally {
                          setIsDriveAuthLoading(false);
                        }
                      }}
                      disabled={isDriveAuthLoading}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 font-bold text-slate-700 text-xs uppercase tracking-widest transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    >
                      {isDriveAuthLoading ? "Menghubungkan..." : "Hubungkan Google Drive"}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  disabled={isUploading}
                  className="h-14 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 font-extrabold text-xs text-slate-700 uppercase tracking-widest active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedFile || !selectedTugas) {
                      setUploadMessage({
                        text: "Silakan pilih file tugas terlebih dahulu.",
                        type: "error",
                      });
                      return;
                    }

                    if (needsDriveAuth) {
                      setUploadMessage({
                        text: "Silakan hubungkan Google Drive terlebih dahulu.",
                        type: "error",
                      });
                      return;
                    }
                    
                    setIsUploading(true);
                    setUploadMessage({ text: "Mengupload ke Google Drive...", type: "success" });
                    try {
                      const link = await uploadFileToDrive(selectedFile as any);

                      setUploadMessage({ text: "Menyimpan ke sistem...", type: "success" });
                      const submissionId = `SUB-${student.nisn}-${selectedTugas.id}`;
                      const newSubmissionObj = {
                        id: submissionId,
                        assignmentId: selectedTugas.id,
                        nisn: student.nisn,
                        studentName: student.displayName,
                        kelas: student.kelas,
                        fileUrl: link, // Save link directly
                        submittedAt: new Date().toISOString(),
                        status: "menunggu penilaian",
                      };
                      // Optimistic update
                      mutateSubmissions([...submissionsList.filter((s: any) => s.id !== submissionId), newSubmissionObj], false);

                      await setDoc(
                        doc(db, "submissions", submissionId),
                        newSubmissionObj,
                        { merge: true },
                      );
                      trackUsage(0, 1);
                      mutateSubmissions(); // Refetch properly
                      setUploadMessage({
                        text: "Tugas berhasil dikumpulkan!",
                        type: "success",
                      });
                      setTimeout(() => {
                        setIsUploadModalOpen(false);
                        setUploadMessage({ text: "", type: "" });
                        setSelectedFile(null);
                      }, 2000);
                    } catch (error: any) {
                      setUploadMessage({
                        text: error.message || "Terjadi kesalahan saat mengumpulkan tugas.",
                        type: "error",
                      });
                    } finally {
                      setIsUploading(false);
                    }
                  }}
                  disabled={!selectedFile || isUploading || needsDriveAuth}
                  className="h-14 rounded-2xl bg-[#85cc00] hover:brightness-110 text-slate-900 font-extrabold text-xs uppercase tracking-widest shadow-lg shadow-[#85cc00]/20 active:scale-95 transition-all text-center flex items-center justify-center cursor-pointer border border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isUploading ? "Mengirim..." : "Kumpulkan"}
                </button>
MIDDLE_EOF

cat top.tsx middle.tsx bottom.tsx > src/pages/DashboardStudent.tsx
rm top.tsx middle.tsx bottom.tsx

EOF

bash update_modal.sh

