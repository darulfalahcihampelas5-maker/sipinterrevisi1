import { getAccessToken } from './googleAuth';

export const uploadFileToDrive = async (file: File): Promise<string> => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("User is not authenticated with Google Drive.");
  }

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.warn("Drive upload error:", errorText);
    throw new Error('Gagal mengupload file ke Google Drive');
  }

  const data = await res.json();
  const fileId = data.id;
  const webViewLink = data.webViewLink;

  // Make the file public (Anyone with link can view)
  const permissionRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
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

  if (!permissionRes.ok) {
    console.warn("Failed to update permissions:", await permissionRes.text());
    // Continue anyway, but the link might not be accessible
  }

  return webViewLink;
};

export const uploadFileToDriveWithToken = async (file: File, token: string, kelas?: string, studentName?: string, customFileName?: string): Promise<string> => {
  let parentFolderId: string | null = null;

  if (kelas) {
    const classFolderName = kelas.trim().toLowerCase().startsWith("kelas") ? kelas.trim() : `Tugas Kelas ${kelas.trim()}`;
    let classFolderId: string | null = null;

    try {
      // 1. Search for existing folder named "Tugas Kelas <kelas>"
      const findClassQuery = `name = '${classFolderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(findClassQuery)}&fields=files(id)`;
      
      const searchRes = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.files && searchData.files.length > 0) {
          classFolderId = searchData.files[0].id;
        }
      }

      // 2. Create class folder if it doesn't exist
      if (!classFolderId) {
        const createUrl = 'https://www.googleapis.com/drive/v3/files';
        const createRes = await fetch(createUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: classFolderName,
            mimeType: 'application/vnd.google-apps.folder'
          })
        });

        if (createRes.ok) {
          const createData = await createRes.json();
          classFolderId = createData.id;
        }
      }

      // 3. If studentName is provided, search or create student folder inside the Class folder
      if (classFolderId) {
        if (studentName) {
          const studentFolderName = studentName.trim().toUpperCase();
          const findStudentQuery = `name = '${studentFolderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and '${classFolderId}' in parents and trashed = false`;
          const studentSearchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(findStudentQuery)}&fields=files(id)`;

          const studentSearchRes = await fetch(studentSearchUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${token}`
            }
          });

          let studentFolderId: string | null = null;
          if (studentSearchRes.ok) {
            const studentSearchData = await studentSearchRes.json();
            if (studentSearchData.files && studentSearchData.files.length > 0) {
              studentFolderId = studentSearchData.files[0].id;
            }
          }

          if (!studentFolderId) {
            const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                name: studentFolderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [classFolderId]
              })
            });

            if (createRes.ok) {
              const createData = await createRes.json();
              studentFolderId = createData.id;
            }
          }

          parentFolderId = studentFolderId || classFolderId;
        } else {
          parentFolderId = classFolderId;
        }
      }
    } catch (err) {
      console.warn("Gagal mendeteksi atau membuat folder di Google Drive:", err);
    }
  }

  // Get extension from original file
  const originalName = file.name;
  const extension = originalName.includes('.') ? originalName.split('.').pop() : '';
  const finalFileName = customFileName 
    ? (extension ? `${customFileName}.${extension}` : customFileName)
    : originalName;

  const metadata: any = {
    name: finalFileName,
    mimeType: file.type || 'application/octet-stream',
  };

  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  let fileId = "";
  let webViewLink = "";

  // Google Drive multipart upload has a limit of 5MB. Files > 5MB must use Resumable Upload.
  const IS_LARGE_FILE = file.size > 5 * 1024 * 1024; // 5 MB

  if (IS_LARGE_FILE) {
    // RESUMABLE UPLOAD (For files > 5MB)
    // See: https://developers.google.com/drive/api/v3/manage-uploads#resumable
    const initUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    
    const initRes = await fetch(initUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': file.type || 'application/octet-stream',
      },
      body: JSON.stringify(metadata),
    });

    if (!initRes.ok) {
      const errorText = await initRes.text();
      console.warn("Google Drive upload warning (handled by student fallback):", initRes.status, errorText);
      if (initRes.status === 401) {
        throw new Error("Sesi Google Drive Guru telah kedaluwarsa atau tidak aktif! (Error 401)");
      }
      throw new Error(`Gagal mempersiapkan pengunggahan file besar (${initRes.status})`);
    }

    const sessionUri = initRes.headers.get('Location');
    if (!sessionUri) {
      console.warn("Location header missing in resumable upload init response");
      throw new Error('Gagal mendapatkan session URL untuk pengunggahan file besar');
    }

    // PUT file content directly
    const uploadRes = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.warn("Gagal melakukan resumable upload content:", uploadRes.status, errorText);
      throw new Error(`Gagal mengirimkan konten file besar (${uploadRes.status})`);
    }

    const uploadData = await uploadRes.json();
    fileId = uploadData.id;
    
    // For resumable upload, we might need a separate GET to get the webViewLink if it's not in the PUT response
    // But usually it's there if we added it to fields, but wait, I removed fields from initUrl.
    // Let's add it to the initUrl or the PUT url. 
    // Actually, documentation says put it in the initial POST.
    // Let's try adding it to the PUT URL.
    if (uploadData.webViewLink) {
      webViewLink = uploadData.webViewLink;
    } else {
      // Fallback: get file details
      const getFileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=webViewLink`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (getFileRes.ok) {
        const getData = await getFileRes.json();
        webViewLink = getData.webViewLink;
      }
    }
  } else {
    // MULTIPART UPLOAD (For files <= 5MB)
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: form
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn("Google Drive upload warning (handled by student fallback):", errorText);
      if (res.status === 401) {
        throw new Error("Sesi Google Drive Guru telah kedaluwarsa atau tidak aktif! (Error 401)");
      }
      throw new Error('Gagal mengupload file ke Google Drive');
    }

    const data = await res.json();
    fileId = data.id;
    webViewLink = data.webViewLink;
  }

  // Make the file public (Anyone with link can view)
  const permissionRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
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

  if (!permissionRes.ok) {
    console.warn("Failed to update permissions:", await permissionRes.text());
  }

  return webViewLink;
};
