/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, ChangeEvent, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Presentation, FileText, Sparkles, ArrowRight, Github, ChevronLeft, 
  Layout, Palette, Moon, Sun, Hash, Wand2, PenLine, Image as ImageIcon, 
  Video, Play, Pause, ChevronRight, CheckCircle2, LogIn, User
} from "lucide-react";

type View = "dashboard" | "ppt-config" | "ppt-content-entry";

const apps = [
  {
    id: "ppt-maker",
    title: "AI PPT Maker",
    description: "Create stunning presentations from simple prompts using advanced AI models.",
    icon: <Presentation className="w-8 h-8 text-blue-500" />,
    color: "from-blue-50/50 to-indigo-50/50",
    borderColor: "group-hover:border-blue-200",
    tag: "Beta"
  },
  {
    id: "ieee-maker",
    title: "AI IEEE Maker",
    description: "Format and generate academic-grade IEEE papers with automated citations and structure.",
    icon: <FileText className="w-8 h-8 text-emerald-500" />,
    color: "from-emerald-50/50 to-teal-50/50",
    borderColor: "group-hover:border-emerald-200",
    tag: "Soon"
  }
];

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [pptConfig, setPptConfig] = useState({
    ratio: "16:9",
    theme: "light",
    textColor: "#000000",
    slides: 5,
    contentType: ""
  });
  
  const [slidesData, setSlidesData] = useState<Array<{ text: string, mediaUrl: string, mediaType: 'image' | 'video' | 'none' }>>(
    Array(20).fill(null).map(() => ({ text: "", mediaUrl: "", mediaType: "none" }))
  );

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [googleUser, setGoogleUser] = useState<any>(() => {
    const saved = localStorage.getItem('google_access_token');
    return saved ? { access_token: saved } : null;
  });
  const [geminiResult, setGeminiResult] = useState<string>("");
  const [isGeminiLoading, setIsGeminiLoading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Theme Sync
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // OAuth Listener
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        const tokens = event.data.payload;
        if (tokens?.access_token) {
          localStorage.setItem('google_access_token', tokens.access_token);
          setGoogleUser(tokens);
          // Automatically send the prompt after login
          sendShimlaPrompt(tokens.access_token);
        }
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, []);

  const handleGoogleLogin = async () => {
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      
      window.open(url, 'google_auth_popup', 'width=600,height=700');
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const sendShimlaPrompt = async (token: string) => {
    setIsGeminiLoading(true);
    setGeminiResult("");
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Suggest a dress for a trip to Shimla in 50 words." }] }]
          })
        }
      );

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || "Gemini API Error");
      }

      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setGeminiResult(resultText || "No response received.");
    } catch (error: any) {
      console.error("Gemini Error:", error);
      setGeminiResult(`Error fetching from Gemini: ${error.message}`);
    } finally {
      setIsGeminiLoading(false);
    }
  };

  const handleGenerateWithAI = async () => {
    if (!googleUser?.access_token) {
      alert("Please sign in with Google first to use AI generation.");
      handleGoogleLogin();
      return;
    }
    
    // This is where we would call Gemini to generate the full PPT structure
    // For now, let's trigger a focused prompt as a demonstration
    setIsGeminiLoading(true);
    setGeminiResult("");
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${googleUser.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Create a presentation outline with ${pptConfig.slides} slides about a modern tech startup. Format as JSON list of slide topics.` }] }]
          })
        }
      );

      const data = await response.json();
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setGeminiResult(resultText || "No response received.");
      
      // In a real flow, we'd parse this JSON and update slidesData
      alert("AI content generated successfully! View the result in the sidebar.");
    } catch (error: any) {
      console.error("PPT Generation Error:", error);
      alert("Failed to generate PPT with AI.");
    } finally {
      setIsGeminiLoading(false);
    }
  };

  const handleContentTypeSelect = (type: string) => {
    setPptConfig(prev => ({ ...prev, contentType: type }));
    if (type === "manual") {
      setView("ppt-content-entry");
      setCurrentSlideIndex(0);
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'none';
    
    updateSlideData("mediaUrl", url);
    updateSlideData("mediaType", type);
    
    // Reset input so the same file can be uploaded again if needed
    e.target.value = '';
  };

  const triggerFileUpload = (type: 'image' | 'video') => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'image' ? 'image/*' : 'video/*';
      fileInputRef.current.click();
    }
  };

  const toggleVideoPlayback = () => {
    if (videoRef.current) {
      if (isVideoPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsVideoPlaying(!isVideoPlaying);
    }
  };

  const handleNextSlide = () => {
    if (currentSlideIndex < pptConfig.slides - 1) {
      setCurrentSlideIndex(prev => prev + 1);
      setIsVideoPlaying(false);
    }
  };

  const handlePrevSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(prev => prev - 1);
      setIsVideoPlaying(false);
    }
  };

  const updateSlideData = (field: string, value: any) => {
    setSlidesData(prev => {
      const newData = [...prev];
      newData[currentSlideIndex] = { ...newData[currentSlideIndex], [field]: value };
      return newData;
    });
  };

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-gray-950 font-sans selection:bg-black selection:text-white dark:selection:bg-white dark:selection:text-black overflow-x-hidden transition-colors duration-500">
      {/* Top Right Controls */}
      <div className="fixed top-6 right-6 z-[100] flex flex-col items-end gap-3">
        <div className="flex items-center gap-3">
          {googleUser ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-full shadow-sm">
              <User className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-gray-600 dark:text-gray-300">Signed In</span>
            </div>
          ) : (
            <button 
              onClick={handleGoogleLogin}
              className="flex items-center gap-2 px-5 py-2.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-full shadow-sm hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-200"
            >
              <LogIn className="w-4 h-4 text-blue-500" />
              Sign in with Google
            </button>
          )}
          
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-full shadow-sm hover:shadow-md transition-all text-gray-600 dark:text-gray-300"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>

        {/* AI Response Display (Directly below Login) */}
        <AnimatePresence>
          {isGeminiLoading || geminiResult ? (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="w-80 max-h-[400px] overflow-auto bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-gray-100 dark:border-gray-800 rounded-3xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Gemini 1.5 Flash</span>
                </div>
                <button 
                  onClick={() => setGeminiResult("")}
                  className="text-gray-300 hover:text-gray-500"
                >
                  <Hash className="w-3 h-3 rotate-45" />
                </button>
              </div>
              {isGeminiLoading ? (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 bg-blue-500 rounded-full animate-bounce" />
                  <span className="text-sm text-gray-500 italic">Asking Gemini...</span>
                </div>
              ) : (
                <div className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">
                  <div className="font-bold mb-2 text-xs text-blue-500 uppercase">Shimla Trip Suggestion:</div>
                  {geminiResult}
                </div>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* AI Response Display (DELETED OLD FLOATING BUTTON/BOX CODE FROM THIS POSITION) */}

      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-100/30 dark:bg-blue-900/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-100/30 dark:bg-emerald-900/10 blur-[120px] rounded-full" />
      </div>

      <AnimatePresence mode="wait">
        {view === "dashboard" ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4 }}
            className="relative max-w-7xl mx-auto px-6 py-12 lg:py-24"
          >
            {/* Header Section */}
            <header className="mb-20">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="flex items-center gap-2 mb-4"
              >
                <div className="bg-black dark:bg-white text-white dark:text-black p-1 rounded">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-xs font-bold tracking-widest uppercase text-gray-500 dark:text-gray-400">
                  Intelligence Studio
                </span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="text-6xl md:text-8xl font-display font-medium tracking-tight text-gray-900 dark:text-white mb-6"
              >
                GENIE AI
              </motion.h1>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="flex flex-col md:flex-row md:items-center gap-4 text-xl md:text-2xl text-gray-400 dark:text-gray-500"
              >
                <span className="font-light italic font-serif">POWERED BY</span>
                <span className="font-bold text-gray-900 dark:text-white tracking-widest text-3xl md:text-4xl underline decoration-blue-500/30 underline-offset-8 decoration-4">
                  JAY SINGH
                </span>
              </motion.div>
            </header>

            {/* Apps Grid */}
            <div className="grid md:grid-cols-2 gap-8 lg:gap-12 content-start">
              {apps.map((app, index) => (
                <motion.button
                  key={app.id}
                  onClick={() => app.id === "ppt-maker" && setView("ppt-config")}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.3 + index * 0.1 }}
                  className={`group relative text-left bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-8 lg:p-12 transition-all duration-500 hover:shadow-2xl hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 flex flex-col justify-between overflow-hidden active:scale-[0.98] ${app.id === 'ppt-maker' ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'} ${app.borderColor}`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${app.color} dark:from-gray-800 dark:to-gray-900 opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-8">
                      <div className="p-4 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-50 dark:border-gray-700">
                        {app.icon}
                      </div>
                      <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {app.tag}
                      </span>
                    </div>
                    
                    <h3 className="text-3xl font-display font-semibold text-gray-900 dark:text-white mb-4 group-hover:translate-x-1 transition-transform duration-300">
                      {app.title}
                    </h3>
                    
                    <p className="text-gray-500 dark:text-gray-400 max-w-[280px] leading-relaxed mb-12">
                      {app.description}
                    </p>
                  </div>

                  <div className="relative z-10 flex items-center justify-between group/btn pt-12 border-t border-gray-50 dark:border-gray-800">
                    <span className="text-sm font-semibold tracking-wide text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-colors">
                      {app.id === 'ppt-maker' ? 'Get started' : 'Coming soon'}
                    </span>
                    <div className="w-12 h-12 rounded-full border border-gray-100 dark:border-gray-800 group-hover:border-black dark:group-hover:border-white group-hover:bg-black dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black flex items-center justify-center transition-all duration-300 transform group-hover:rotate-45">
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            <footer className="mt-20 pt-12 border-t border-gray-100 dark:border-gray-900 flex flex-col md:flex-row justify-between items-center gap-6">
              <p className="text-sm text-gray-400 dark:text-gray-500">
                © 2026 Genie AI Studio. All rights reserved.
              </p>
              <div className="flex items-center gap-8 text-gray-400 dark:text-gray-500">
                <a href="#" className="hover:text-black dark:hover:text-white transition-colors text-sm font-medium">Privacy</a>
                <a href="#" className="hover:text-black dark:hover:text-white transition-colors text-sm font-medium">Terms</a>
                <a href="#" className="hover:text-black dark:hover:text-white transition-colors">
                  <Github className="w-5 h-5" />
                </a>
              </div>
            </footer>
          </motion.div>
        ) : view === "ppt-config" ? (
          <motion.div
            key="ppt-config"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.4 }}
            className="relative max-w-4xl mx-auto px-6 py-12 lg:py-24"
          >
            <button
              onClick={() => setView("dashboard")}
              className="flex items-center gap-2 text-gray-400 hover:text-black transition-colors mb-12 group"
            >
              <ChevronLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
              <span className="font-medium">Back to dashboard</span>
            </button>

            <header className="mb-16">
              <h2 className="text-5xl font-display font-medium text-black dark:text-white mb-4">
                Configuration
              </h2>
              <p className="text-gray-400 dark:text-gray-500 text-xl font-light">
                Tailor your presentation parameters before we generate the magic.
              </p>
            </header>

            <div className="space-y-12">
              {/* Ratio Selection */}
              <section>
                <div className="flex items-center gap-3 mb-6">
                  <Layout className="w-5 h-5 text-blue-500" />
                  <h3 className="font-semibold text-lg dark:text-gray-200">Aspect Ratio</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "16:9", sub: "Widescreen", icon: <Presentation className="w-6 h-6" /> },
                    { label: "9:16", sub: "Vertical / Mobile", icon: <Presentation className="w-6 h-6 rotate-90" /> }
                  ].map((r) => (
                    <button
                      key={r.label}
                      onClick={() => setPptConfig(prev => ({ ...prev, ratio: r.label }))}
                      className={`flex flex-col items-center justify-center p-8 rounded-3xl border-2 transition-all duration-300 ${pptConfig.ratio === r.label ? 'border-black dark:border-white bg-white dark:bg-gray-900 shadow-xl' : 'border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-950/50 text-gray-400 opacity-60 hover:opacity-100'}`}
                    >
                      <div className="mb-3">{r.icon}</div>
                      <span className="font-bold text-xl mb-1">{r.label}</span>
                      <span className="text-xs uppercase tracking-widest opacity-60">{r.sub}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Theme Selection */}
              <section>
                <div className="flex items-center gap-3 mb-6">
                  <Moon className="w-5 h-5 text-indigo-500" />
                  <h3 className="font-semibold text-lg dark:text-gray-200">Visual Theme</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: "light", label: "Light", icon: <Sun className="w-5 h-5" /> },
                    { id: "dark", label: "Dark", icon: <Moon className="w-5 h-5" /> }
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setPptConfig(prev => ({ ...prev, theme: t.id }))}
                      className={`flex items-center gap-4 p-6 rounded-2xl border-2 transition-all duration-300 ${pptConfig.theme === t.id ? 'border-black dark:border-white bg-white dark:bg-gray-900 shadow-lg' : 'border-gray-100 dark:border-gray-800 bg-white/50 dark:bg-gray-950/50 text-gray-400'}`}
                    >
                      <div className={`p-2 rounded-lg ${pptConfig.theme === t.id ? 'bg-black dark:bg-white text-white dark:text-black' : 'bg-gray-100 dark:bg-gray-800'}`}>
                        {t.icon}
                      </div>
                      <span className="font-bold">{t.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Text Color & Slides */}
              <div className="grid md:grid-cols-2 gap-12">
                <section>
                  <div className="flex items-center gap-3 mb-6">
                    <Palette className="w-5 h-5 text-pink-500" />
                    <h3 className="font-semibold text-lg dark:text-gray-200">Text Color</h3>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl">
                    <input
                      type="color"
                      value={pptConfig.textColor}
                      onChange={(e) => setPptConfig(prev => ({ ...prev, textColor: e.target.value }))}
                      className="w-12 h-12 rounded-lg cursor-pointer border-none bg-transparent"
                    />
                    <div>
                      <div className="font-mono font-bold uppercase dark:text-gray-200">{pptConfig.textColor}</div>
                      <div className="text-[10px] text-gray-400 uppercase tracking-widest">Hex Code</div>
                    </div>
                  </div>
                </section>

                <section>
                  <div className="flex items-center gap-3 mb-6">
                    <Hash className="w-5 h-5 text-orange-500" />
                    <h3 className="font-semibold text-lg dark:text-gray-200">Number of Slides</h3>
                  </div>
                  <div className="flex items-center gap-6 p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl">
                    <input
                      type="range"
                      min="1"
                      max="20"
                      value={pptConfig.slides}
                      onChange={(e) => setPptConfig(prev => ({ ...prev, slides: parseInt(e.target.value) }))}
                      className="flex-1 accent-black dark:accent-white h-2 bg-gray-100 dark:bg-gray-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-3xl font-display font-bold w-12 text-center dark:text-white">{pptConfig.slides}</span>
                  </div>
                </section>
              </div>

              {/* Final Choice */}
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-12 border-t border-gray-200 dark:border-gray-800"
              >
                <div className="text-center mb-8">
                  <h3 className="text-2xl font-display font-medium mb-2 dark:text-white">How would you like to proceed?</h3>
                  <p className="text-gray-400 dark:text-gray-500">Choose the synthesis method for your presentation content.</p>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <button
                    onClick={handleGenerateWithAI}
                    className={`group p-8 rounded-3xl border-2 transition-all duration-300 text-left relative overflow-hidden ${pptConfig.contentType === 'ai' ? 'border-blue-500 bg-blue-50/30' : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-200 dark:hover:border-gray-700'}`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-blue-500 text-white rounded-xl">
                        <Wand2 className="w-6 h-6" />
                      </div>
                    </div>
                    <h4 className="text-xl font-bold mb-2 dark:text-white">Create with AI</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                      Enter a topic and let our engine generate text, layout, and structure automatically.
                    </p>
                  </button>

                  <button
                    onClick={() => handleContentTypeSelect("manual")}
                    className={`group p-8 rounded-3xl border-2 transition-all duration-300 text-left relative overflow-hidden ${pptConfig.contentType === 'manual' ? 'border-emerald-500 bg-emerald-50/30' : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-200 dark:hover:border-gray-700'}`}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-emerald-500 text-white rounded-xl">
                        <PenLine className="w-6 h-6" />
                      </div>
                    </div>
                    <h4 className="text-xl font-bold mb-2 dark:text-white">Write Content</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                      Provide your own text for each slide while we handle the design and layout optimization.
                    </p>
                  </button>
                </div>
              </motion.section>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="ppt-content-entry"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="relative max-w-5xl mx-auto px-6 py-12 lg:py-24"
          >
            <div className="flex items-center justify-between mb-12">
              <button
                onClick={() => setView("ppt-config")}
                className="flex items-center gap-2 text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white transition-colors group"
              >
                <ChevronLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
                <span className="font-medium">Back to config</span>
              </button>
              
              <div className="flex items-center gap-3">
                {[...Array(pptConfig.slides)].map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === currentSlideIndex ? 'w-8 bg-black dark:bg-white' : 'w-2 bg-gray-200 dark:bg-gray-800'}`}
                  />
                ))}
              </div>
            </div>

            {/* Hidden File Input */}
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden" 
            />

            <div className="grid lg:grid-cols-[1fr_400px] gap-8">
              <div className="space-y-6">
                <header>
                  <div className="text-sm font-bold uppercase tracking-widest text-blue-500 mb-2">Editor Mode</div>
                  <h2 className="text-4xl font-display font-medium text-black dark:text-white">Slide {currentSlideIndex + 1}</h2>
                </header>

                <div className="relative group/box">
                  <textarea
                    value={slidesData[currentSlideIndex].text}
                    onChange={(e) => updateSlideData("text", e.target.value)}
                    placeholder="Type content here..."
                    className="w-full h-[400px] p-8 lg:p-12 text-2xl font-light leading-relaxed bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-[40px] focus:outline-none focus:ring-4 focus:ring-blue-50 dark:focus:ring-blue-900/20 focus:border-blue-200 dark:focus:border-blue-800 transition-all resize-none shadow-sm dark:text-white"
                  />
                  <div className="absolute top-8 right-8 flex gap-2 opacity-0 group-focus-within/box:opacity-100 group-hover/box:opacity-100 transition-opacity">
                    <button 
                      onClick={() => triggerFileUpload("image")}
                      className={`p-3 rounded-2xl border transition-all ${slidesData[currentSlideIndex].mediaType === 'image' ? 'bg-blue-500 text-white border-blue-500 shadow-lg' : 'bg-white dark:bg-gray-800 text-gray-400 border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
                      title="Upload Image"
                    >
                      <ImageIcon className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => triggerFileUpload("video")}
                      className={`p-3 rounded-2xl border transition-all ${slidesData[currentSlideIndex].mediaType === 'video' ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg' : 'bg-white dark:bg-gray-800 text-gray-400 border-gray-100 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
                      title="Upload Video"
                    >
                      <Video className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-8">
                  <button
                    onClick={handlePrevSlide}
                    disabled={currentSlideIndex === 0}
                    className="flex items-center gap-2 font-bold text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" /> Prev
                  </button>
                  <button
                    onClick={handleNextSlide}
                    className={`flex items-center gap-3 py-4 px-10 rounded-full font-bold transition-all ${currentSlideIndex === pptConfig.slides - 1 ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-black dark:bg-white text-white dark:text-black hover:px-12'}`}
                  >
                    {currentSlideIndex === pptConfig.slides - 1 ? (
                      <><CheckCircle2 className="w-5 h-5" /> Finalize</>
                    ) : (
                      <>Next Slide <ChevronRight className="w-5 h-5" /></>
                    )}
                  </button>
                </div>
              </div>

              {/* Media Preview / Uploaded Area */}
              <div className="space-y-6">
                <div className="aspect-[4/3] bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-[32px] overflow-hidden relative flex items-center justify-center group shadow-sm">
                  <AnimatePresence mode="wait">
                    {slidesData[currentSlideIndex].mediaType === "none" ? (
                      <motion.div
                        key="none"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-center text-gray-300 dark:text-gray-600 pointer-events-none"
                      >
                        <ImageIcon className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p className="text-sm font-medium px-8 leading-relaxed">Select image or video from the top-right icons to upload</p>
                      </motion.div>
                    ) : slidesData[currentSlideIndex].mediaType === "image" ? (
                      <motion.img
                        key={slidesData[currentSlideIndex].mediaUrl}
                        initial={{ scale: 1.1, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        src={slidesData[currentSlideIndex].mediaUrl}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <motion.div
                        key={slidesData[currentSlideIndex].mediaUrl}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-full h-full relative"
                      >
                        <video 
                          ref={videoRef}
                          src={slidesData[currentSlideIndex].mediaUrl}
                          className="w-full h-full object-cover"
                          onEnded={() => setIsVideoPlaying(false)}
                        />
                        <div 
                          onClick={toggleVideoPlayback}
                          className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-colors duration-500 ${isVideoPlaying ? 'bg-black/0' : 'bg-black/40'}`}
                        >
                          {!isVideoPlaying && (
                            <motion.div
                              initial={{ scale: 0.8, opacity: 0 }}
                              animate={{ scale: 1, opacity: 1 }}
                              className="w-20 h-20 rounded-full bg-white shadow-2xl flex items-center justify-center"
                            >
                              <Play className="w-8 h-8 text-black fill-current ml-1" />
                            </motion.div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
                <div className="bg-gray-100/50 dark:bg-gray-900/50 p-6 rounded-3xl border border-gray-100 dark:border-gray-800">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-4">Content Summary</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Words</span>
                      <span className="font-bold dark:text-white">{slidesData[currentSlideIndex].text.trim().split(/\s+/).filter(Boolean).length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Characters</span>
                      <span className="font-bold dark:text-white">{slidesData[currentSlideIndex].text.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



