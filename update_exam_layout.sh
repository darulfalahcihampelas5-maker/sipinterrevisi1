sed -i 's/<header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0 shadow-sm relative z-10">/<header className="h-20 bg-white border-b border-slate-200 px-4 md:px-8 flex items-center justify-between shrink-0 shadow-sm relative z-20">/g' src/pages/DashboardStudent.tsx

sed -i 's/<div className="flex items-center gap-6">/<div className="flex items-center gap-3 md:gap-6">/g' src/pages/DashboardStudent.tsx

# Add the toggle button before the CBT logo
sed -i 's/<div className="flex items-center gap-3 pr-6 border-r border-slate-100">/<button onClick={() => setIsQuestionNavOpen(!isQuestionNavOpen)} className="lg:hidden p-2 -ml-2 mr-2 text-slate-500 hover:text-slate-900 focus:outline-none"><svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"><\/line><line x1="3" y1="6" x2="21" y2="6"><\/line><line x1="3" y1="18" x2="21" y2="18"><\/line><\/svg><\/button>\n                  <div className="flex items-center gap-3 pr-3 md:pr-6 border-r border-slate-100 hidden md:flex">/g' src/pages/DashboardStudent.tsx

