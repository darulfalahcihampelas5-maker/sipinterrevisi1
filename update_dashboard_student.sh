sed -i 's/gap-2 sm:gap-3/gap-1.5 sm:gap-2/g' src/pages/DashboardStudent.tsx
sed -i 's/gap-2 sm:gap-3/gap-1.5 sm:gap-2/g' src/pages/DashboardTeacher.tsx

# Replace Student avatar
sed -i 's/<User className="w-full h-full text-slate-400 translate-y-1.5" fill="currentColor" \/>/<User className="w-[120%] h-[120%] text-[#aeb4bb] translate-y-1.5" fill="currentColor" \/>/g' src/pages/DashboardStudent.tsx
sed -i 's/bg-slate-200 text-\[#85cc00\] shadow-sm border border-slate-200/bg-\[#e4e6eb\] text-\[#85cc00\] shadow-sm border border-slate-200/g' src/pages/DashboardStudent.tsx

# Replace Teacher avatar
sed -i 's/<User className="w-full h-full text-slate-400 translate-y-1.5" fill="currentColor" \/>/<User className="w-[120%] h-[120%] text-[#aeb4bb] translate-y-1.5" fill="currentColor" \/>/g' src/pages/DashboardTeacher.tsx
sed -i 's/bg-slate-200 text-\[#85cc00\] shadow-sm border border-slate-200/bg-\[#e4e6eb\] text-\[#85cc00\] shadow-sm border border-slate-200/g' src/pages/DashboardTeacher.tsx

