export const getDriveImageUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  const cleanUrl = url.trim();

  // If already base64 or blob or local asset, return directly
  if (cleanUrl.startsWith("data:") || cleanUrl.startsWith("blob:") || cleanUrl.startsWith("/")) {
    return cleanUrl;
  }

  // Regex patterns to match Google Drive File ID (25+ alphanumeric chars with - and _)
  // Supports:
  // - drive.google.com/file/d/{id}/view...
  // - drive.google.com/open?id={id}
  // - drive.google.com/uc?id={id}
  // - docs.google.com/file/d/{id}/
  // - lh3.googleusercontent.com/d/{id}
  const matchD = cleanUrl.match(/\/(?:file\/)?d\/([-\w]{25,})/i);
  const matchQuery = cleanUrl.match(/[?&]id=([-\w]{25,})/i);
  const matchLh3 = cleanUrl.match(/lh3\.googleusercontent\.com\/d\/([-\w]{25,})/i);

  const fileId = matchD ? matchD[1] : (matchQuery ? matchQuery[1] : (matchLh3 ? matchLh3[1] : ""));

  if (fileId) {
    // Official Google CDN URL for direct public image embedding
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }

  // If user pasted raw file ID directly (e.g. 1P395tuZymxs3qero4XduMpHy7g2GJrdR)
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(cleanUrl)) {
    return `https://lh3.googleusercontent.com/d/${cleanUrl}`;
  }

  return cleanUrl;
};

// Fallback secondary URL in case primary CDN has a temporary block
export const getDriveImageFallbackUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  const cleanUrl = url.trim();
  const match = cleanUrl.match(/(?:\/d\/|id=|lh3\.googleusercontent\.com\/d\/)([-\w]{25,})/i);
  if (match && match[1]) {
    return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w800`;
  }
  return cleanUrl;
};

// Helper for embedding Google Drive PDF preview in iframe
export const getDrivePdfEmbedUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  const cleanUrl = url.trim();
  const matchD = cleanUrl.match(/\/(?:file\/)?d\/([-\w]{25,})/i);
  const matchQuery = cleanUrl.match(/[?&]id=([-\w]{25,})/i);
  const fileId = matchD ? matchD[1] : (matchQuery ? matchQuery[1] : "");
  if (fileId) {
    return `https://drive.google.com/file/d/${fileId}/preview`;
  }
  return cleanUrl;
};

