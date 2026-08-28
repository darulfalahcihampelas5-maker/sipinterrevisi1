sed -i 's/} lg:static lg:translate-x-0 lg:shadow-none ${/} lg:static lg:translate-x-0 lg:shadow-none transition-all duration-300 ease-in-out shrink-0 ${/' src/pages/DashboardTeacher.tsx
sed -i 's/isSidebarOpen ? "lg:w-80" : "lg:w-0 overflow-hidden"/isSidebarOpen ? "lg:w-80" : "lg:w-0 overflow-hidden border-r-0 border-none opacity-0 lg:opacity-100"/g' src/pages/DashboardTeacher.tsx
