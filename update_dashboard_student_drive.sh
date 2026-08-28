#!/bin/bash

# Add imports
sed -i 's/import { getDriveImageUrl } from "..\/lib\/driveUtils";/import { getDriveImageUrl } from "..\/lib\/driveUtils";\nimport { initAuth, googleSignIn, getAccessToken } from "..\/lib\/googleAuth";\nimport { uploadFileToDrive } from "..\/lib\/driveUpload";/g' src/pages/DashboardStudent.tsx

# Add state variables inside DashboardStudent component
# Let's find "const navigate = useNavigate();"
sed -i 's/  const navigate = useNavigate();/  const navigate = useNavigate();\n  const [needsDriveAuth, setNeedsDriveAuth] = useState(false);\n  const [isDriveAuthLoading, setIsDriveAuthLoading] = useState(false);\n  const [uploadProgress, setUploadProgress] = useState(false);/g' src/pages/DashboardStudent.tsx

# Add useEffect for initAuth
# Let's find "useEffect(() => {" around line 447
sed -i 's/  useEffect(() => {/  useEffect(() => {\n    initAuth(\n      () => setNeedsDriveAuth(false),\n      () => setNeedsDriveAuth(true)\n    );\n  }, []);\n\n  useEffect(() => {/1' src/pages/DashboardStudent.tsx
