/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ChangeEvent, FormEvent, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import pptxgen from "pptxgenjs";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Presentation, FileText, Sparkles, ArrowRight, Github, ChevronLeft, 
  Layout, Palette, Moon, Sun, Hash, Wand2, Image as ImageIcon, 
  Video, Play, Pause, ChevronRight, CheckCircle2, Download, RefreshCw,
  Loader2, Eye, EyeOff, FileOutput, Heart, Copy, ExternalLink, Terminal,
  Settings as SettingsIcon, Info, UserCircle, X, Battery, Key, ShieldCheck, Check, Lock, LogOut,
  Maximize2, Minimize2, Upload, Paperclip, File, Trash2
} from "lucide-react";

// Firebase Imports
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, getDocFromServer, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { RAGService, Chunk } from "./services/ragService";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const googleProvider = new GoogleAuthProvider();

type View = "dashboard" | "ppt-config" | "ppt-topic-entry" | "ppt-structure-entry" | "ppt-subtopic-entry" | "ppt-summary-preview" | "ppt-generation-prompt" | "ppt-content-entry" | "ppt-preview" | "ppt-final";

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

const handleFirestoreError = (error: any, operationType: FirestoreErrorInfo['operationType'], path: string | null) => {
  if (error.code === 'permission-denied') {
    const errorInfo: FirestoreErrorInfo = {
      error: error.message,
      operationType,
      path,
      authInfo: {
        userId: auth.currentUser?.uid || 'anonymous',
        email: auth.currentUser?.email || '',
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || false,
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || ''
        })) || []
      }
    };
    console.error(JSON.stringify(errorInfo));
  }
  throw error;
};

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

interface ConsoleLog {
  type: 'log' | 'error' | 'warn';
  message: string;
  timestamp: number;
}

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string; // base64 or text
  mimeType: string;
}

export interface RecentWork {
  id: string;
  topic: string;
  code: string;
  timestamp: number;
}

export default function App() {
  const [generatedCode, setGeneratedCode] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [iterativePrompt, setIterativePrompt] = useState("");
  const [isIterating, setIsIterating] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [generationTimer, setGenerationTimer] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [topic, setTopic] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [recentWorks, setRecentWorks] = useState<RecentWork[]>([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsIndexing(true);
    const newFiles: UploadedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();

      const fileData = await new Promise<string>((resolve) => {
        reader.onload = (e) => {
          const result = e.target?.result as string;
          if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
             resolve(result); // Plain text
          } else {
             // Extract base64 part
             const base64 = result.split(',')[1] || result;
             resolve(base64);
          }
        };
        if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
           reader.readAsText(file);
        } else {
           reader.readAsDataURL(file);
        }
      });

      newFiles.push({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: file.type,
        size: file.size,
        data: fileData,
        mimeType: file.type || 'application/octet-stream'
      });
    }

    setUploadedFiles(prev => [...prev, ...newFiles]);
    
    // RAG Indexing: Chunk the combined documents (Text files only)
    if (ragService) {
      const textFiles = newFiles.filter(f => f.type.startsWith('text/') || f.name.endsWith('.txt') || f.name.endsWith('.md'));
      if (textFiles.length > 0) {
        setIsIndexing(true);
        try {
          const combinedText = textFiles.map(f => `File: ${f.name}\n${f.data}`).join("\n\n---\n\n");
          const newChunks = await ragService.chunkDocument(combinedText);
          setChunks(prev => [...prev, ...newChunks]);
        } catch (e) {
          console.error("RAG Chunking failed", e);
        } finally {
          setIsIndexing(false);
        }
      }
    } else {
      // Fallback for indexing state if no service available
      setTimeout(() => setIsIndexing(false), 1500);
    }
  };

  const removeFile = (id: string) => {
    setUploadedFiles(prev => {
        const filtered = prev.filter(f => f.id !== id);
        // If all files removed, clear chunks (simplification)
        if (filtered.length === 0) setChunks([]);
        return filtered;
    });
  };

  const getGeminiParts = () => {
    const parts = uploadedFiles.map(file => ({
      inlineData: {
        mimeType: file.mimeType,
        data: file.data
      }
    }));
    return parts;
  };

  const [isLiked, setIsLiked] = useState(false);
  const [subtopics, setSubtopics] = useState<string[]>([]);
  const [activeSubtopicIndex, setActiveSubtopicIndex] = useState(0);
  const [aiPasteBuffer, setAiPasteBuffer] = useState("");
  const [currentPrompt, setCurrentPrompt] = useState("");
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const [apiError, setApiError] = useState<{message: string, type: 'missing' | 'invalid'} | null>(null);
  
  const [pptConfig, setPptConfig] = useState({
    ratio: "16:9",
    theme: "light",
    textColor: "#000000",
    slides: 5,
    contentType: ""
  });
  
  const [slidesData, setSlidesData] = useState<Array<{ title: string, text: string, mediaUrl: string, mediaType: 'image' | 'video' | 'none' }>>(
    Array(20).fill(null).map(() => ({ title: "", text: "", mediaUrl: "", mediaType: "none" }))
  );

  const [userApiKey, setUserApiKey] = useState("");
  const [isKeySaved, setIsKeySaved] = useState(false);

  const ragService = useMemo(() => {
    if (!userApiKey) return null;
    return new RAGService(userApiKey);
  }, [userApiKey]);
  const [tempApiKey, setTempApiKey] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  
  const previewRef = useRef<HTMLDivElement>(null);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("Firestore connected successfully.");
        setIsOffline(false);
      } catch (error) {
        if(error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('unavailable'))) {
          console.error("Firestore is offline. Please check your Firebase configuration or connection.");
          setIsOffline(true);
        }
      }
    }
    testConnection();
  }, []);

  // Listen for Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthLoading(false);
      
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.geminiApiKey) {
              setUserApiKey(data.geminiApiKey);
              setTempApiKey(data.geminiApiKey);
            }
          }
        } catch (error: any) {
          if (error.code === 'unavailable') {
            console.error("Firestore backend is unavailable. Operating in offline mode.");
            setIsOffline(true);
            setAuthError("Syncing with cloud is currently unavailable. Your changes will be saved locally.");
          } else {
            console.error("Error fetching user data:", error);
            handleFirestoreError(error, 'get', `users/${firebaseUser.uid}`);
          }
        }
      } else {
        setUserApiKey("");
        setTempApiKey("");
      }
    });
    return () => unsubscribe();
  }, []);

  // Load Recent Works based on User
  useEffect(() => {
    if (user) {
      const saved = localStorage.getItem(`genie_recent_works_${user.uid}`);
      if (saved) {
        try {
          setRecentWorks(JSON.parse(saved));
        } catch (e) {
          console.error("Failed to load recent works", e);
          setRecentWorks([]);
        }
      } else {
        setRecentWorks([]);
      }
    } else {
      setRecentWorks([]);
    }
  }, [user]);

  const saveToRecentWorks = (topic: string, code: string) => {
    if (!user) return;

    const newWork: RecentWork = {
      id: Math.random().toString(36).substr(2, 9),
      topic,
      code,
      timestamp: Date.now()
    };
    
    setRecentWorks(prev => {
      const updated = [newWork, ...prev].slice(0, 3);
      localStorage.setItem(`genie_recent_works_${user.uid}`, JSON.stringify(updated));
      return updated;
    });
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserApiKey("");
      setTempApiKey("");
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const getAiInstance = () => {
    if (!userApiKey) {
       return null;
    }
    return new GoogleGenAI({ apiKey: userApiKey });
  };

  const saveApiKey = async () => {
    if (!tempApiKey.trim()) {
      setApiError({ message: "Please enter a valid API key.", type: 'missing' });
      return;
    }

    setUserApiKey(tempApiKey);
    setApiError(null);
    setIsKeySaved(true);
    
    // Persist to Firebase if logged in
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), {
          geminiApiKey: tempApiKey,
          updatedAt: serverTimestamp()
        }, { merge: true });
        setIsOffline(false);
      } catch (error: any) {
        if (error.code === 'unavailable') {
           setIsOffline(true);
        }
        handleFirestoreError(error, 'write', `users/${user.uid}`);
      }
    }

    setTimeout(() => setIsKeySaved(false), 2000);
  };

  const handleContentTypeSelect = () => {
    setPptConfig(prev => ({ ...prev, contentType: "ai" }));
    setView("ppt-topic-entry");
  };

  const handleTopicSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    
    const fileContext = uploadedFiles.length > 0 ? ` Please use the provided attached files (knowledge base) as primary reference material for the content.` : "";
    const prompt = `I want to create a professional presentation about: "${topic}".${fileContext} Provide exactly ${pptConfig.slides} distinct sub-topics for the slides. Format each sub-topic on a new line and DO NOT include numbers or bullet points. Output ONLY the titles. Absolutely no introductory or concluding text. Just the titles.`;
    setCurrentPrompt(prompt);
    setView("ppt-structure-entry");
  };

  const automatedStructureGeneration = async () => {
    const aiInstance = getAiInstance();
    if (!aiInstance) {
      setApiError({ message: "GENIE AI API Key is missing. Please provide it in settings to continue.", type: 'missing' });
      setIsSettingsOpen(true);
      return;
    }

    setIsAILoading(true);
    setGenerationTimer(0);
    try {
      const parts = [
        ...getGeminiParts(),
        { text: currentPrompt }
      ];

      const result = await aiInstance.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts }
      });
      setAiPasteBuffer(result.text || "");
    } catch (error: any) {
      console.error("AI Structure Generation failed:", error);
      if (error?.message?.includes("API_KEY_INVALID") || error?.status === 403 || error?.message?.includes("not authorized")) {
        setApiError({ message: "The API Key provided is invalid. Please check your key in settings.", type: 'invalid' });
        setIsSettingsOpen(true);
      }
    } finally {
      setIsAILoading(false);
    }
  };

  const automatedSubtopicGeneration = async () => {
    const aiInstance = getAiInstance();
    if (!aiInstance || !ragService) {
      if (!aiInstance) {
          setApiError({ message: "GENIE AI API Key is missing. Please provide it in settings to continue.", type: 'missing' });
          setIsSettingsOpen(true);
          return;
      }
    }

    setIsAILoading(true);
    setGenerationTimer(0);
    try {
      let finalContent = "";
      
      if (chunks.length > 0 && ragService) {
        // RAG Pipeline
        const subtopic = subtopics[activeSubtopicIndex];
        const relevantChunks = await ragService.retrieveRelevantChunks(chunks, subtopic);
        const contextString = await ragService.generateContextString(relevantChunks);
        
        let slideData = await ragService.generateSlide(subtopic, contextString);
        const verification = await ragService.verifySlideDetailed(slideData, contextString);
        
        if (verification.score < 7) {
          slideData = await ragService.regenerateSlideSmart(subtopic, contextString, verification.issues, verification.suggestions);
        }
        
        finalContent = `${slideData.title}\n\n${slideData.points.map(p => `• ${p}`).join("\n")}`;
      } else {
        // Legacy flow
        const parts = [
          ...getGeminiParts(),
          { text: currentPrompt }
        ];

        const result = await aiInstance!.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: { parts }
        });
        finalContent = result.text || "";
      }
      
      setAiPasteBuffer(finalContent);
    } catch (error: any) {
      console.error("AI Subtopic Generation failed:", error);
      if (error?.message?.includes("API_KEY_INVALID") || error?.status === 403) {
        setApiError({ message: "The API Key provided is invalid. Please check your key in settings.", type: 'invalid' });
        setIsSettingsOpen(true);
      }
    } finally {
      setIsAILoading(false);
    }
  };

  const automatedWebsiteGeneration = async () => {
    const aiInstance = getAiInstance();
    if (!aiInstance) {
      setApiError({ message: "GENIE AI API Key is missing. Please provide it in settings to continue.", type: 'missing' });
      setIsSettingsOpen(true);
      return;
    }

    setIsAILoading(true);
    setGenerationTimer(0);
    try {
      const parts = [
        ...getGeminiParts(),
        { text: `${currentPrompt}\n\nIMPORTANT: Do NOT include any "Export to PDF" or "Download PDF" buttons or scripts in your output. The main application handles exporting. Focus only on a beautiful, interactive, and responsive web design. Ensure all scripts are inline or from trusted CDNs.` }
      ];

      const result = await aiInstance.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts }
      });
      const code = result.text || "";
      // Match content inside markdown code blocks (```html ... ```)
      const codeMatch = code.match(/```(?:html|xml)?\s*([\s\S]*?)```/i);
      const strippedCode = codeMatch ? codeMatch[1].trim() : code.replace(/```html|```xml|```/g, "").trim();
      
      setGeneratedCode(strippedCode);
      saveToRecentWorks(topic || "Untitled Synthesis", strippedCode);
      // Switch view after generation
      // setView("ppt-preview"); 
    } catch (error: any) {
      console.error("Website Synthesis failed:", error);
      if (error?.message?.includes("API_KEY_INVALID") || error?.status === 403) {
        setApiError({ message: "The API Key provided is invalid. Please check your key in settings.", type: 'invalid' });
        setIsSettingsOpen(true);
      }
    } finally {
      setIsAILoading(false);
    }
  };

  const handleIterativeGeneration = async () => {
    if (!iterativePrompt.trim()) return;
    
    const aiInstance = getAiInstance();
    if (!aiInstance) return;

    setIsIterating(true);
    try {
      const parts = [
        ...getGeminiParts(),
        { text: `Currently, the website code is as follows:\n\n${generatedCode}\n\nUser request for changes: "${iterativePrompt}"\n\nIMPORTANT: Do NOT include any "Export to PDF" or "Download PDF" buttons or scripts. Output the updated FULL code for the website including the changes. Output ONLY the code block.` }
      ];

      const result = await aiInstance.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts }
      });
      
      const code = result.text || "";
      const codeMatch = code.match(/```(?:html|xml)?\s*([\s\S]*?)```/i);
      const strippedCode = codeMatch ? codeMatch[1].trim() : code.replace(/```html|```xml|```/g, "").trim();
      
      setGeneratedCode(strippedCode);
      saveToRecentWorks(topic || "Updated Synthesis", strippedCode);
      setIterativePrompt("");
    } catch (error) {
      console.error("Iteration failed:", error);
    } finally {
      setIsIterating(false);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'iframe-log') {
        setConsoleLogs(prev => [...prev, {
          type: event.data.level,
          message: event.data.message,
          timestamp: Date.now()
        }].slice(-50)); // Keep last 50
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const injectedCode = useMemo(() => {
    if (!generatedCode) return "";
    const logScript = `
      <script>
        (function() {
          const originalLog = console.log;
          const originalError = console.error;
          const originalWarn = console.warn;
          
          const send = (level, args) => {
            window.parent.postMessage({
              type: 'iframe-log',
              level,
              message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
            }, '*');
          };

          console.log = (...args) => { originalLog(...args); send('log', args); };
          console.error = (...args) => { originalError(...args); send('error', args); };
          console.warn = (...args) => { originalWarn(...args); send('warn', args); };

          window.onerror = (msg, url, line) => {
            send('error', [\`Uncaught Error: \${msg} at \${line}\`]);
          };
        })();
      </script>
    `;
    return generatedCode.replace('<head>', '<head>' + logScript);
  }, [generatedCode]);

  useEffect(() => {
    let interval: any;
    if (isAILoading) {
      interval = setInterval(() => {
        setGenerationTimer(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isAILoading]);

  const handleStructureProcess = () => {
    if (!aiPasteBuffer.trim()) return;
    
    const extracted = aiPasteBuffer.split('\n')
      .map(line => line.replace(/^\d+\.\s*|-\s*/, '').trim())
      .filter(line => line.length > 0 && !line.endsWith(':') && line.length < 100)
      .slice(0, pptConfig.slides);
    
    if (extracted.length === 0) return;
    
    setSubtopics(extracted);
    setActiveSubtopicIndex(0);
    setAiPasteBuffer("");
    
    const firstSubtopicPrompt = `Explain the sub-topic "${extracted[0]}" for a presentation about "${topic}". Provide a clear, engaging slide title and exactly 4 detailed bullet points summarizing the key aspects of this sub-topic.`;
    setCurrentPrompt(firstSubtopicPrompt);
    setView("ppt-subtopic-entry");
  };

  const handleSubtopicProcess = () => {
    if (!aiPasteBuffer.trim()) return;
    
    setSlidesData(prev => {
      const newData = [...prev];
      // Basic parsing of the AI response (using the prompt instructions as a guide)
      const lines = aiPasteBuffer.split('\n').filter(l => l.trim().length > 0);
      const title = subtopics[activeSubtopicIndex];
      const body = aiPasteBuffer; // Use full text for body
      
      newData[activeSubtopicIndex] = {
        ...newData[activeSubtopicIndex],
        title: title,
        text: body,
        mediaType: 'none',
        mediaUrl: ''
      };
      return newData;
    });

    if (activeSubtopicIndex < subtopics.length - 1) {
      const nextIndex = activeSubtopicIndex + 1;
      setActiveSubtopicIndex(nextIndex);
      setAiPasteBuffer("");
      const nextPrompt = `Explain the sub-topic "${subtopics[nextIndex]}" for a presentation about "${topic}". Provide a clear, engaging slide title and exactly 4 detailed bullet points summarizing the key aspects of this sub-topic.`;
      setCurrentPrompt(nextPrompt);
    } else {
      setView("ppt-summary-preview");
      setAiPasteBuffer("");
    }
  };

  const generateFinalPrompt = () => {
    let contentStr = slidesData.slice(0, subtopics.length).map((s, i) => `Slide ${i + 1}: ${s.title}\nContent: ${s.text}`).join('\n\n');
    
    const prompt = `I want to build a high-fidelity, professional website in Google AI Studio Build based on the following presentation content.

Main Topic: ${topic}

Presentation Content:
${contentStr}

Website Requirements:
1. Design & Color Protocol (Tiered HEX Enforcement): 
   - DO NOT USE modern color spaces (oklch, oklab). 
   - ENFORCE EXPLICIT HEX COLORS for all theme levels (Slate, Blue, Emerald).
   - REMOVE ALL Tailwind opacity modifiers (e.g., bg-white/10). Replace with explicit rgba() values like bg-[rgba(255,255,255,0.1)].
   - Use standard RGBA for shadows and glass effects.
2. Structure: One section per slide with clear headings and readable content. EACH section MUST have the class 'slide-render-target'.
3. Feature: Add a prominent "Download as PDF" button.
4. Functionality: CRITICAL - Use html2canvas and jsPDF to capture the website sections as slides.
   - For PDF: Use a fixed ${pptConfig.ratio === '16:9' ? '1920x1080' : '1080x1920'} pixel format (Aspect Ratio: ${pptConfig.ratio}).
   - ANIMATION SYNC: The "Download as PDF" function MUST force all elements to opacity: 1, remove all transforms (transform: none), and disable animations during capture. This resolves "missing content" caused by scroll-triggered animations.
   - Viewport Synchronization: Force the capture engine to behave as a high-resolution desktop screen (1920x1080).
5. Icon Protocol: For "Storage" or power related sections, use a proper Battery icon.

IMPORTANT: Make sure that the PDF download functionality is fully working at the end. Note that a common error to avoid is "Error generating PDF: Attempting to parse an unsupported color function 'oklab'".`;

    setCurrentPrompt(prompt);
    setView("ppt-generation-prompt");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const exportToPDF = async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    
    try {
      const pdf = new jsPDF({
        orientation: pptConfig.ratio === "9:16" ? "portrait" : "landscape",
        unit: "px",
        format: pptConfig.ratio === "9:16" ? [1080, 1920] : [1920, 1080]
      });

      let slides: HTMLElement[] = [];
      const iframe = previewRef.current.querySelector('iframe');
      
      if (iframe && iframe.contentDocument) {
        slides = Array.from(iframe.contentDocument.querySelectorAll('.slide-render-target')) as HTMLElement[];
      }
      
      if (slides.length === 0) {
        slides = Array.from(previewRef.current.querySelectorAll('.slide-render-target')) as HTMLElement[];
      }

      if (slides.length === 0) {
        const target = iframe || previewRef.current;
        slides = [target as HTMLElement];
      }
      
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const canvas = await html2canvas(slide, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: isDarkMode ? '#18181b' : '#ffffff',
          width: pptConfig.ratio === "16:9" ? 1920 : 1080,
          height: pptConfig.ratio === "16:9" ? 1080 : 1920,
          onclone: (clonedDoc) => {
            const allElements = clonedDoc.querySelectorAll('*');
            allElements.forEach((el) => {
              const element = el as HTMLElement;
              element.style.opacity = '1';
              element.style.visibility = 'visible';
              element.style.transform = 'none';
              element.style.animation = 'none';
              element.style.transition = 'none';
              
              const style = window.getComputedStyle(element);
              if (style.backgroundColor && style.backgroundColor.includes('oklch')) {
                 element.style.backgroundColor = '#3b82f6';
              }
              if (style.color && style.color.includes('oklch')) {
                 element.style.color = '#000000';
              }
            });
          }
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i > 0) pdf.addPage();
        
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        // Memory optimization: help garbage collector
        canvas.width = 0;
        canvas.height = 0;
      }

      pdf.save(`Genie_AI_Presentation_${Date.now()}.pdf`);
      setView("ppt-final");
    } catch (error) {
      console.error("PDF Export failed", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFinalizePPTX = async () => {
    setIsGenerating(true);
    setView("ppt-final");
    
    try {
      const pres = new pptxgen();
      if (pptConfig.ratio === "9:16") {
        pres.defineLayout({ name: 'VERTICAL', width: 7.5, height: 13.33 });
        pres.layout = 'VERTICAL';
      } else {
        pres.layout = 'LAYOUT_16x9';
      }

      const bgColor = pptConfig.theme === "dark" ? "1a1a1a" : "ffffff";
      const textColor = pptConfig.textColor.replace('#', '');

      for (let i = 0; i < pptConfig.slides; i++) {
        const slideData = slidesData[i];
        const slide = pres.addSlide();
        slide.background = { color: bgColor };

        if (slideData.title) {
          slide.addText(slideData.title, {
            x: 0.5, y: 0.5, w: 9, h: 0.8, fontSize: 28, bold: true, color: textColor, fontFace: 'Arial'
          });
        }

        slide.addText(slideData.text || `Slide ${i + 1} Content`, {
          x: 0.5, y: slideData.title ? 1.4 : 0.5, w: pptConfig.ratio === "9:16" ? 6.5 : 9, h: 4,
          fontSize: 20, color: textColor, align: 'left', valign: 'top', fontFace: 'Arial'
        });

        if (slideData.mediaType === 'image' && slideData.mediaUrl) {
          try {
            const response = await fetch(slideData.mediaUrl);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            const base64Data = await base64Promise;
            
            slide.addImage({
              data: base64Data, x: 0.5, y: 4.5, w: pptConfig.ratio === "9:16" ? 6.5 : 9, h: pptConfig.ratio === "9:16" ? 8 : 2.5,
            });
          } catch (e) {
            console.error(e);
          }
        }
      }

      await pres.writeFile({ fileName: `Genie_AI_Presentation_${Date.now()}.pptx` });
    } catch (error) {
      console.error("PPT Generation failed", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadNotes = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text(`PRESENTATION NOTES: ${topic.toUpperCase()}`, 10, 20);
    doc.setFontSize(12);
    doc.line(10, 25, 200, 25);
    
    let y = 35;
    slidesData.slice(0, pptConfig.slides).forEach((s, i) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
      doc.setFont("helvetica", "bold");
      doc.text(`[SLIDE ${i + 1}] ${s.title || "Untitled"}`, 10, y);
      y += 7;
      
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(s.text || "", 180);
      lines.forEach((line: string) => {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, 10, y);
        y += 6;
      });
      y += 10;
    });
    
    doc.save(`${topic.replace(/\s+/g, '_')}_Presentation_Notes.pdf`);
  };

  const handleReset = () => {
    setView("dashboard");
    setIsLiked(false);
    setSubtopics([]);
    setActiveSubtopicIndex(0);
    setAiPasteBuffer("");
    setCurrentPrompt("");
    setSlidesData(Array(20).fill(null).map(() => ({ title: "", text: "", mediaUrl: "", mediaType: "none" })));
    setPptConfig({
      ratio: "16:9",
      theme: "light",
      textColor: "#000000",
      slides: 5,
      contentType: ""
    });
  };

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <div className={`min-h-screen transition-colors duration-500 overflow-x-hidden font-sans selection:bg-black selection:text-white ${isDarkMode ? 'bg-zinc-950 text-white' : 'bg-[#fafafa] text-black'}`}>
      {/* Top Left Settings Trigger */}
      <div className="fixed top-6 left-6 z-50">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className={`p-3 rounded-2xl shadow-xl transition-all hover:scale-110 active:scale-95 border ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white' : 'bg-white border-gray-100 text-black'}`}
        >
          <SettingsIcon className="w-6 h-6" />
        </button>
      </div>

      {/* Settings Drawer (Left Corner) */}
      <AnimatePresence>
        {isSettingsOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={`fixed top-0 left-0 bottom-0 z-[110] w-full max-w-sm shadow-2xl overflow-y-auto ${isDarkMode ? 'bg-zinc-900 border-r border-zinc-800' : 'bg-white border-r border-gray-100'}`}
            >
              <div className="p-8">
                <div className="flex items-center justify-between mb-10">
                  <h2 className={`text-2xl font-display font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>Studio Dashboard</h2>
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-6">
                  {/* Auth Section */}
                  <div className={`p-5 rounded-2xl ${isDarkMode ? 'bg-zinc-800/50 border border-zinc-700' : 'bg-gray-50 border border-gray-100'}`}>
                    {isAuthLoading ? (
                      <div className="flex items-center justify-center py-2">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                      </div>
                    ) : user ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {user.photoURL ? (
                            <img src={user.photoURL} alt={user.displayName || "User"} className="w-10 h-10 rounded-full border-2 border-blue-500" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">
                              {(user.displayName || user.email || "?")[0].toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>{user.displayName || user.email?.split('@')[0]}</p>
                            <p className="text-[10px] text-gray-400 font-medium truncate max-w-[140px]">{user.email}</p>
                          </div>
                        </div>
                        <button 
                          onClick={handleLogout}
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          title="Logout"
                        >
                          <LogOut className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <button
                          onClick={handleGoogleLogin}
                          className={`w-full py-3 border rounded-xl shadow-sm flex items-center justify-center gap-3 transition-all font-bold text-sm ${isDarkMode ? 'bg-zinc-800 border-zinc-700 hover:bg-zinc-700 text-white' : 'bg-white border-gray-100 hover:bg-gray-50 text-black'}`}
                        >
                          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                          Sign in with Google
                        </button>
                        
                        {authError && <p className="text-[10px] text-red-500 font-bold text-center">{authError}</p>}
                        
                        <p className={`text-[10px] text-center font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-600' : 'text-gray-400'}`}>
                          Securely synced via Firebase
                        </p>
                      </div>
                    )}
                  </div>

                  {/* API Validation Flash Notice */}
                  <AnimatePresence>
                    {apiError && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className={`p-4 rounded-2xl mb-4 border-2 flex gap-3 ${apiError.type === 'missing' ? 'bg-orange-50 border-orange-100 text-orange-700' : 'bg-red-50 border-red-100 text-red-700'}`}
                      >
                        <ShieldCheck className="w-5 h-5 shrink-0" />
                        <div className="text-xs">
                          <p className="font-bold mb-1">{apiError.type === 'missing' ? "Action Required" : "Invalid Key"}</p>
                          <p>{apiError.message}</p>
                          <button onClick={() => setApiError(null)} className="mt-2 text-[10px] underline font-bold uppercase tracking-wider">Dismiss</button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Theme Toggle */}
                  <div className={`flex items-center justify-between p-5 rounded-2xl ${isDarkMode ? 'bg-zinc-800/50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${isDarkMode ? 'bg-zinc-700 text-yellow-400' : 'bg-white text-blue-600 shadow-sm border border-gray-100'}`}>
                        {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-black'}`}>Theme</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">{isDarkMode ? 'Dark' : 'Light'}</p>
                      </div>
                    </div>
                    <button
                      onClick={toggleDarkMode}
                      className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${isDarkMode ? 'bg-blue-600' : 'bg-gray-200'}`}
                    >
                      <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-300 ${isDarkMode ? 'translate-x-6' : ''}`} />
                    </button>
                  </div>

                  {/* API Settings */}
                  <div className={`p-5 rounded-2xl ${isDarkMode ? 'bg-zinc-800/50' : 'bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${isDarkMode ? 'bg-zinc-700 text-emerald-400' : 'bg-white text-emerald-600 shadow-sm border border-gray-100'}`}>
                          <Key className="w-4 h-4" />
                        </div>
                        <div>
                          <p className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-black'}`}>API Key</p>
                          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">{user ? "Cloud Sync Enabled" : "Local Storage Only"}</p>
                        </div>
                      </div>
                      {user && userApiKey && (
                        <div className="flex items-center gap-1 text-emerald-500 text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 px-2 py-1 rounded-md">
                          <ShieldCheck className="w-3 h-3" /> Synced
                        </div>
                      )}
                      {isOffline && (
                        <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold uppercase tracking-wider bg-red-500/10 px-2 py-1 rounded-md">
                          <Info className="w-3 h-3" /> Offline
                        </div>
                      )}
                    </div>
                    
                    <div className="space-y-3">
                      <div className="relative">
                        <input
                          type={showApiKey ? "text" : "password"}
                          value={tempApiKey}
                          onChange={(e) => setTempApiKey(e.target.value)}
                          placeholder="Your API Key..."
                          className={`w-full p-3.5 pr-20 rounded-xl text-xs border transition-all outline-none ${isDarkMode ? 'bg-zinc-800 border-zinc-700 hocus:border-blue-500 text-white' : 'bg-white border-gray-100 hocus:border-blue-500 text-black shadow-sm'}`}
                        />
                        <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <button 
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="text-gray-400 hover:text-blue-500 transition-colors"
                            type="button"
                          >
                            {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <Lock className="w-3.5 h-3.5 text-gray-400" />
                        </div>
                      </div>
                      
                      <button
                        onClick={saveApiKey}
                        disabled={!tempApiKey.trim()}
                        className={`w-full py-3.5 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 ${isKeySaved ? 'bg-emerald-500 text-white' : (tempApiKey.trim() ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20' : 'bg-black text-white shadow-lg shadow-black/10') : (isDarkMode ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed' : 'bg-gray-200 text-gray-400 cursor-not-allowed'))}`}
                      >
                        {isKeySaved ? <><Check className="w-4 h-4" /> Saved</> : "Apply Key"}
                      </button>
                    </div>
                  </div>

                  {/* Tutorial Option */}
                  <div className={`p-5 rounded-2xl flex items-center justify-between group cursor-pointer transition-all ${isDarkMode ? 'bg-zinc-800/40 border border-zinc-700 hover:bg-zinc-800/60' : 'bg-white border border-gray-100 hover:border-gray-300'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${isDarkMode ? 'bg-zinc-700 text-orange-400' : 'bg-orange-50 text-orange-600 shadow-sm border border-orange-100'}`}>
                        <RefreshCw className="w-4 h-4" />
                      </div>
                      <div>
                        <p className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-black'}`}>Show Tutorial</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase">Coming Soon</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-black transition-transform group-hover:translate-x-1" />
                  </div>

                  {/* About Section (Collapsible) */}
                  <div className={`rounded-2xl overflow-hidden transition-all duration-500 ${isDarkMode ? 'bg-zinc-800/30' : 'bg-blue-50/30 border border-blue-100'}`}>
                    <button 
                      onClick={() => setIsAboutExpanded(!isAboutExpanded)}
                      className="w-full p-5 flex items-center justify-between text-left group"
                    >
                      <div className="flex items-center gap-3">
                        <Info className="w-4 h-4 text-blue-500" />
                        <span className={`font-bold text-sm ${isDarkMode ? 'text-white' : 'text-black'}`}>About Genie AI</span>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-300 ${isAboutExpanded ? 'rotate-90' : ''}`} />
                    </button>
                    
                    <motion.div
                      initial={false}
                      animate={{ height: isAboutExpanded ? "auto" : 0, opacity: isAboutExpanded ? 1 : 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-5 pt-0">
                        <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
                          Genie AI bridges the gap between complex research and professional presentation design. 
                          Leveraging GENIE AI's reasoning, we empower users to create content-rich presentations in minutes.
                          <br /><br />
                          <span className="font-bold underline decoration-blue-500/30 text-blue-500 uppercase tracking-tighter text-[9px]">
                            "Your content, our intelligence."
                          </span>
                        </p>
                      </div>
                    </motion.div>
                  </div>
                </div>

                <div className="mt-12 pt-8 border-t border-gray-100/10">
                   <p className="text-[10px] uppercase font-bold tracking-widest text-gray-400 text-center">Genie AI Studio v1.2.0</p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-[rgba(219,234,254,0.3)] blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-[rgba(209,250,229,0.3)] blur-[120px] rounded-full" />
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
                <div className={`p-1 rounded ${isDarkMode ? 'bg-white text-black' : 'bg-black text-white'}`}>
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className={`text-xs font-bold tracking-widest uppercase ${isDarkMode ? 'text-zinc-500' : 'text-gray-500'}`}>
                  Intelligence Studio
                </span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className={`text-6xl md:text-8xl font-display font-medium tracking-tight mb-6 ${isDarkMode ? 'text-zinc-100' : 'text-black'}`}
              >
                GENIE AI
              </motion.h1>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className={`flex flex-col md:flex-row md:items-center gap-4 text-xl md:text-2xl ${isDarkMode ? 'text-zinc-500' : 'text-gray-400'}`}
              >
                <span className="font-light italic font-serif">POWERED BY</span>
                <span className={`font-bold tracking-widest text-3xl md:text-4xl underline decoration-[rgba(59,130,246,0.3)] underline-offset-8 decoration-4 ${isDarkMode ? 'text-white' : 'text-black'}`}>
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
                  className={`group relative text-left border rounded-3xl p-8 lg:p-12 transition-all duration-500 hover:shadow-2xl flex flex-col justify-between overflow-hidden active:scale-[0.98] ${app.id === 'ppt-maker' ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'} ${isDarkMode ? 'bg-zinc-950 border-zinc-900 shadow-zinc-900/50' : 'bg-white border-gray-100 shadow-gray-200/50'} ${app.borderColor}`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${app.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                  
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-8">
                      <div className={`p-4 rounded-2xl shadow-sm border ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-50'}`}>
                        {app.icon}
                      </div>
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isDarkMode ? 'bg-zinc-900 text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
                        {app.tag}
                      </span>
                    </div>
                    
                    <h3 className={`text-3xl font-display font-semibold mb-4 group-hover:translate-x-1 transition-transform duration-300 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {app.title}
                    </h3>
                    
                    <p className={`leading-relaxed mb-12 max-w-[280px] ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
                      {app.description}
                    </p>
                  </div>

                  <div className={`relative z-10 flex items-center justify-between group/btn pt-12 border-t ${isDarkMode ? 'border-zinc-900' : 'border-gray-50'}`}>
                    <span className={`text-sm font-semibold tracking-wide transition-colors ${isDarkMode ? 'text-zinc-600 group-hover:text-zinc-400' : 'text-gray-400 group-hover:text-gray-600'}`}>
                      {app.id === 'ppt-maker' ? 'Get started' : 'Coming soon'}
                    </span>
                    <div className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-300 transform group-hover:rotate-45 ${isDarkMode ? 'border-zinc-800 group-hover:border-white group-hover:bg-white group-hover:text-black' : 'border-gray-100 group-hover:border-black group-hover:bg-black group-hover:text-white'}`}>
                      <ArrowRight className="w-5 h-5" />
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>

            {/* Recent Work Section */}
            {recentWorks.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.6 }}
                className="mt-24"
              >
                <div className="flex items-center gap-3 mb-10">
                  <RefreshCw className="w-5 h-5 text-blue-500 animate-[spin_4s_linear_infinite]" />
                  <h2 className={`text-2xl font-display font-bold tracking-tight uppercase ${isDarkMode ? 'text-zinc-400' : 'text-gray-400'}`}>
                    Recent Creations
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {recentWorks.map((work) => (
                    <button
                      key={work.id}
                      onClick={() => {
                        setTopic(work.topic);
                        setGeneratedCode(work.code);
                        setView("ppt-preview");
                      }}
                      className={`group p-6 rounded-3xl border text-left transition-all hover:scale-[1.02] active:scale-95 ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700' : 'bg-white border-gray-100 hover:border-blue-100 shadow-sm'}`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                          <Eye className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {new Date(work.timestamp).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className={`text-lg font-bold line-clamp-1 mb-2 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                        {work.topic}
                      </h4>
                      <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
                        A synthesized website experience based on AI models.
                      </p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            <footer className={`mt-20 pt-12 border-t flex flex-col md:flex-row justify-between items-center gap-6 ${isDarkMode ? 'border-zinc-900' : 'border-gray-100'}`}>
              <p className="text-sm text-gray-400">
                © 2026 Genie AI Studio. All rights reserved.
              </p>
              <div className="flex items-center gap-8 text-gray-400">
                <a href="#" className="hover:text-current transition-colors text-sm font-medium">Privacy</a>
                <a href="#" className="hover:text-current transition-colors text-sm font-medium">Terms</a>
                <a href="#" className="hover:text-current transition-colors">
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
              className={`flex items-center gap-2 transition-colors mb-12 group ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}
            >
              <ChevronLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
              <span className="font-medium">Back to dashboard</span>
            </button>

            <header className="mb-16">
              <h2 className={`text-5xl font-display font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                Configuration
              </h2>
              <p className="text-gray-400 text-xl font-light">
                Tailor your presentation parameters before we generate the magic.
              </p>
            </header>

            <div className="space-y-12">
              {/* Ratio Selection */}
              <section>
                <div className="flex items-center gap-3 mb-6">
                  <Layout className="w-5 h-5 text-blue-500" />
                  <h3 className="font-semibold text-lg">Aspect Ratio</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "16:9", sub: "Widescreen", icon: <Presentation className="w-6 h-6" /> },
                    { label: "9:16", sub: "Vertical / Mobile", icon: <Presentation className="w-6 h-6 rotate-90" /> }
                  ].map((r) => (
                    <button
                      key={r.label}
                      onClick={() => setPptConfig(prev => ({ ...prev, ratio: r.label }))}
                      className={`flex flex-col items-center justify-center p-8 rounded-3xl border-2 transition-all duration-300 ${pptConfig.ratio === r.label ? (isDarkMode ? 'border-white bg-zinc-800 shadow-xl shadow-white/5' : 'border-black bg-white shadow-xl') : (isDarkMode ? 'border-zinc-800 bg-zinc-900/50 text-zinc-600' : 'border-gray-100 bg-[rgba(255,255,255,0.5)] text-gray-400 opacity-60 hover:opacity-100')}`}
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
                  <h3 className="font-semibold text-lg">Visual Theme</h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { id: "light", label: "Light", icon: <Sun className="w-5 h-5" /> },
                    { id: "dark", label: "Dark", icon: <Moon className="w-5 h-5" /> }
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setPptConfig(prev => ({ ...prev, theme: t.id }))}
                      className={`flex items-center gap-4 p-6 rounded-2xl border-2 transition-all duration-300 ${pptConfig.theme === t.id ? (isDarkMode ? 'border-white bg-zinc-800 shadow-lg shadow-white/5' : 'border-black bg-white shadow-lg') : (isDarkMode ? 'border-zinc-800 bg-zinc-900/50 text-zinc-600' : 'border-gray-100 bg-[rgba(255,255,255,0.5)] text-gray-400')}`}
                    >
                      <div className={`p-2 rounded-lg ${pptConfig.theme === t.id ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white') : (isDarkMode ? 'bg-zinc-800' : 'bg-gray-100')}`}>
                        {t.icon}
                      </div>
                      <span className="font-bold">{t.label}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Slides Configuration */}
              <section>
                <div className="flex items-center gap-3 mb-6">
                  <Hash className="w-5 h-5 text-orange-500" />
                  <h3 className="font-semibold text-lg">Number of Slides</h3>
                </div>
                <div className={`flex items-center gap-6 p-4 border rounded-2xl transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={pptConfig.slides}
                    onChange={(e) => setPptConfig(prev => ({ ...prev, slides: parseInt(e.target.value) }))}
                    className={`flex-1 h-2 rounded-lg appearance-none cursor-pointer ${isDarkMode ? 'accent-white bg-zinc-800' : 'accent-black bg-gray-100'}`}
                  />
                  <span className={`text-3xl font-display font-bold w-12 text-center ${isDarkMode ? 'text-white' : 'text-black'}`}>{pptConfig.slides}</span>
                </div>
              </section>

              {/* Final Proceed Button */}
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-12 border-t border-gray-200"
              >
                <div className="text-center mb-8">
                  <h3 className={`text-2xl font-display font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-black'}`}>Ready to generate?</h3>
                  <p className="text-gray-400">Our engine will help you create a professional presentation structure automatically.</p>
                </div>
                
                <button
                  onClick={handleContentTypeSelect}
                  className={`w-full group p-8 rounded-3xl border-2 transition-all duration-300 flex items-center justify-between overflow-hidden hover:scale-[1.02] shadow-2xl ${isDarkMode ? 'border-white bg-white text-black shadow-white/5' : 'border-black bg-black text-white shadow-black/10'}`}
                >
                  <div className="flex items-center gap-6">
                    <div className={`p-4 backdrop-blur-md rounded-2xl ${isDarkMode ? 'bg-black/10' : 'bg-white/20'}`}>
                      <Wand2 className={`w-8 h-8 ${isDarkMode ? 'text-black' : 'text-white'}`} />
                    </div>
                    <div className="text-left">
                      <h4 className="text-2xl font-bold mb-1">Create with AI</h4>
                      <p className={`text-sm leading-relaxed max-w-sm ${isDarkMode ? 'text-zinc-600' : 'text-gray-400'}`}>
                        Enter a topic and let GENIE AI generate structured content and themes for you.
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center justify-center w-12 h-12 rounded-full transition-all ${isDarkMode ? 'bg-black/10 group-hover:bg-black/20' : 'bg-white/10 group-hover:bg-white/20'}`}>
                    <ArrowRight className="w-6 h-6" />
                  </div>
                </button>
              </motion.section>
            </div>
          </motion.div>
        ) : view === "ppt-topic-entry" ? (
          <motion.div
            key="ppt-topic-entry"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative max-w-2xl mx-auto px-6 py-24 text-center"
          >
            <button
              onClick={() => setView("ppt-config")}
              className={`flex items-center gap-2 transition-colors mb-12 group mx-auto ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}
            >
              <ChevronLeft className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
              <span className="font-medium">Back to config</span>
            </button>

            <header className="mb-12">
              <div className="w-20 h-20 bg-blue-500 text-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-[rgba(59,130,246,0.3)]">
                <Wand2 className="w-10 h-10" />
              </div>
              <h2 className={`text-4xl font-display font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-black'}`}>What's the topic?</h2>
              <p className="text-gray-500 text-lg">Tell us what your presentation is about, and we will generate the content</p>
            </header>

            <form onSubmit={handleTopicSubmit} className="space-y-8">
              <div className="relative group">
                <textarea
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. The impact of blockchain on global supply chains..."
                  className={`w-full h-32 p-6 text-xl border rounded-3xl focus:outline-none focus:ring-4 transition-all resize-none shadow-sm ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-white focus:ring-white/5 focus:border-zinc-700' : 'bg-white border-gray-100 focus:ring-blue-50 focus:border-blue-200'}`}
                />
              </div>

              {/* File Upload Section */}
              <div className="space-y-4 text-left">
                <div className="flex items-center justify-between">
                  <h4 className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-gray-400'}`}>
                    Knowledge Base (RAG)
                  </h4>
                  <span className="text-[10px] bg-blue-500/10 text-blue-500 px-2 py-1 rounded-md font-bold underline cursor-help" title="Augment generation with your own documents, images, and data">What is this?</span>
                </div>
                
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4`}>
                  <label className={`relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-3xl cursor-pointer transition-all ${isDarkMode ? 'border-zinc-800 hover:border-zinc-600 bg-zinc-900/50 hover:bg-zinc-900' : 'border-gray-200 hover:border-blue-300 bg-white hover:bg-blue-50/30'}`}>
                    <Upload className="w-8 h-8 text-blue-500 mb-2" />
                    <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>Upload Files</span>
                    <span className="text-[10px] text-gray-500 mt-1">PDF, Excel, Images, Video</span>
                    <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                  </label>

                  <div className={`flex flex-col gap-2 max-h-[140px] overflow-y-auto p-2 rounded-2xl transition-all ${isDarkMode ? 'bg-zinc-900/30' : 'bg-gray-50/50'} ${isIndexing ? 'opacity-50 grayscale' : ''}`}>
                    {isIndexing && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/5 rounded-2xl backdrop-blur-[1px]">
                         <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 px-4 py-2 rounded-full shadow-lg border border-blue-500/30">
                           <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                           <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tighter">Indexing Data...</span>
                         </div>
                      </div>
                    )}
                    {uploadedFiles.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 opacity-50 italic text-[10px] py-8">
                        <Paperclip className="w-5 h-5 mb-1" />
                        No files attached
                      </div>
                    ) : (
                      uploadedFiles.map(file => (
                        <div key={file.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-gray-100 shadow-sm'}`}>
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className="p-1.5 bg-blue-500/10 rounded-lg shrink-0">
                              <File className="w-3.5 h-3.5 text-blue-500" />
                            </div>
                            <div className="overflow-hidden">
                              <p className={`text-[10px] font-bold truncate ${isDarkMode ? 'text-white' : 'text-black'}`}>{file.name}</p>
                              <p className="text-[8px] text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                            </div>
                          </div>
                          <button 
                            type="button" 
                            onClick={() => removeFile(file.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={!topic.trim()}
                className={`w-full py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-black text-white shadow-black/10'}`}
              >
                Create Prompt <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          </motion.div>
        ) : view === "ppt-structure-entry" || view === "ppt-subtopic-entry" ? (
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl mx-auto px-6 py-12"
          >
            <div className={`border rounded-[48px] overflow-hidden shadow-2xl flex flex-col md:flex-row h-full md:min-h-[600px] ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
              {/* Prompt Area */}
              <div className={`w-full md:w-5/12 p-10 border-b md:border-b-0 md:border-r transition-colors ${isDarkMode ? 'bg-zinc-950/50 border-zinc-800' : 'bg-[rgba(249,250,251,0.5)] border-gray-100'}`}>
                <div className="flex items-center gap-2 mb-8">
                  <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                    <Terminal className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Step {view === "ppt-structure-entry" ? '01' : `02 - ${activeSubtopicIndex + 1}/5`}</span>
                </div>

                <h3 className={`text-2xl font-display font-medium mb-6 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                  {view === "ppt-structure-entry" ? 'Generate Structure' : `Defining ${subtopics[activeSubtopicIndex]}`}
                </h3>
                
                <div className={`border rounded-2xl p-6 mb-8 relative group transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
                  <p className={`text-sm leading-relaxed italic pr-8 ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
                    {currentPrompt}
                  </p>
                  <button 
                    onClick={() => copyToClipboard(currentPrompt)}
                    className={`absolute top-4 right-4 transition-colors ${isDarkMode ? 'text-zinc-600 hover:text-white' : 'text-gray-300 hover:text-black'}`}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <p className="text-xs text-gray-400 leading-relaxed uppercase tracking-wide font-bold">Automation Active</p>
                  <p className="text-sm text-gray-500">
                    The prompt is ready. Click "Run AI for this Step" to automatically generate the content using GENIE AI.
                  </p>
                </div>
              </div>

              {/* Paste Area / Result Area */}
              <div className="flex-1 p-10 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <h4 className="font-bold text-gray-400 text-sm uppercase tracking-widest">
                    {isAILoading ? "GENIE AI is Thinking..." : "AI Response"}
                  </h4>
                  {aiPasteBuffer && !isAILoading && (
                    <span className="text-[10px] bg-emerald-50 text-emerald-600 px-2 py-1 rounded-full font-bold">READY</span>
                  )}
                </div>
                                  <div className="relative flex-1 mb-8">
                  {isAILoading ? (
                    <div className={`absolute inset-0 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed transition-all ${isDarkMode ? 'bg-zinc-950/50 border-zinc-700' : 'bg-[rgba(249,250,251,0.5)] border-gray-200'}`}>
                      <RefreshCw className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                      <p className="text-gray-400 font-medium animate-pulse">Generating your content...</p>
                    </div>
                  ) : (
                    <textarea
                      value={aiPasteBuffer}
                      onChange={(e) => setAiPasteBuffer(e.target.value)}
                      placeholder={view === "ppt-structure-entry" ? "Results will appear here..." : "Sub-topic content will appear here..."}
                      className={`w-full h-full border-2 rounded-3xl p-8 resize-none outline-none transition-all font-light text-lg leading-relaxed shadow-inner ${isDarkMode ? 'bg-zinc-900 border-zinc-800 focus:border-white/20 text-zinc-300' : 'bg-white border-gray-100 focus:border-black text-gray-700'}`}
                    />
                  )}
                </div>

                {!aiPasteBuffer && !isAILoading ? (
                  <button
                    onClick={view === "ppt-structure-entry" ? automatedStructureGeneration : automatedSubtopicGeneration}
                    className={`w-full py-6 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-xl ${isDarkMode ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-blue-500/10' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'}`}
                  >
                    <Sparkles className="w-5 h-5" /> Run AI for this Step
                  </button>
                ) : (
                  <button
                    onClick={view === "ppt-structure-entry" ? handleStructureProcess : handleSubtopicProcess}
                    disabled={!aiPasteBuffer.trim() || isAILoading}
                    className={`w-full py-6 rounded-2xl font-bold flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl disabled:opacity-20 ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-black text-white shadow-[rgba(0,0,0,0.1)]'}`}
                  >
                    {view === "ppt-structure-entry" ? "Confirm Structure" : (activeSubtopicIndex === subtopics.length - 1 ? "Review Final Content" : "Confirm & Next Sub-topic")}
                    <ArrowRight className="w-5 h-5" />
                  </button>
                )}

              </div>
            </div>
          </motion.div>
        ) : view === "ppt-summary-preview" ? (
          <motion.div
            key="ppt-summary-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="max-w-5xl mx-auto px-6 py-24"
          >
            <header className="text-center mb-20">
              <div className={`inline-flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest mb-6 ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                <CheckCircle2 className="w-4 h-4" /> Content Compilation Complete
              </div>
              <h2 className={`text-6xl font-display font-medium mb-6 ${isDarkMode ? 'text-white' : 'text-black'}`}>Review Final Content</h2>
              <p className="text-gray-400 text-xl font-light">Here is the summarized structure for your presentation.</p>
            </header>

            <div className="space-y-6 mb-20">
              <div className={`border rounded-[40px] p-10 shadow-sm transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
                <h3 className={`text-xs font-bold uppercase tracking-widest mb-8 pb-4 border-b ${isDarkMode ? 'text-zinc-500 border-zinc-800' : 'text-gray-300 border-gray-50'}`}>Main Topic: {topic}</h3>
                
                <div className="space-y-12">
                  {slidesData.slice(0, subtopics.length).map((slide, idx) => (
                    <div key={idx} className="flex gap-10">
                      <div className={`text-5xl font-display font-bold mt-[-8px] ${isDarkMode ? 'text-zinc-800' : 'text-gray-100'}`}>0{idx + 1}</div>
                      <div>
                        <h4 className={`text-2xl font-display font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-black'}`}>{slide.title}</h4>
                        <div className={`prose prose-sm whitespace-pre-wrap leading-relaxed font-light ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
                          {slide.text}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-8">
              <button
                onClick={generateFinalPrompt}
                className={`py-6 px-20 border rounded-full font-bold text-xl transition-all hover:scale-105 active:scale-95 shadow-2xl ${isDarkMode ? 'bg-white text-black border-white shadow-white/5' : 'bg-black text-white border-black shadow-black/20'}`}
              >
                Create Presentation Prompt
              </button>
              
              <button 
                onClick={handleReset}
                className={`font-semibold transition-colors ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}
              >
                Discard and Start Over
              </button>
            </div>
          </motion.div>
        ) : view === "ppt-generation-prompt" ? (
          <motion.div
            key="ppt-generation-prompt"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="max-w-4xl mx-auto px-6 py-24"
          >
            <div className="text-center mb-16">
              <div className={`inline-flex items-center gap-2 px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest mb-6 ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                🚀 Step 03: Final Deployment
              </div>
              <h2 className={`text-5xl font-display font-medium mb-6 ${isDarkMode ? 'text-white' : 'text-black'}`}>Your Website Prompt is Ready</h2>
              <p className="text-gray-400 text-xl font-light max-w-2xl mx-auto">
                Copy this comprehensive prompt to Google AI Studio Build to generate your interactive website with PDF export functionality.
              </p>
            </div>

            <div className={`border rounded-[48px] overflow-hidden shadow-2xl transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
              <div className={`p-10 border-b flex items-center justify-between transition-colors ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-[rgba(249,250,251,0.5)] border-gray-100'}`}>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500 text-white rounded-lg">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <span className={`font-bold text-sm uppercase tracking-widest ${isDarkMode ? 'text-zinc-500' : 'text-gray-500'}`}>Google AI Studio Build Prompt</span>
                </div>
                <button 
                  onClick={() => copyToClipboard(currentPrompt)}
                  className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-bold transition-all shadow-sm ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-white hover:bg-zinc-700' : 'bg-white border-gray-200 text-black hover:bg-gray-50'}`}
                >
                  <Copy className="w-4 h-4" /> Copy Prompt
                </button>
              </div>

              <div className="p-10 max-h-[400px] overflow-y-auto">
                <pre className={`font-mono text-sm leading-relaxed whitespace-pre-wrap transition-colors ${isDarkMode ? 'text-zinc-400' : 'text-gray-600'}`}>
                  {currentPrompt}
                </pre>
              </div>

              <div className={`p-10 flex flex-col md:flex-row items-center justify-between gap-8 transition-colors ${isDarkMode ? 'bg-zinc-950 text-white' : 'bg-black text-white'}`}>
                <div className="flex-1">
                  <h4 className="text-xl font-bold mb-2">
                    {isAILoading ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin" /> 
                        Building Website... ({generationTimer}s)
                      </span>
                    ) : (isDarkMode ? "Build with GENIE AI" : "Ready to Build?")}
                  </h4>
                  <p className="text-gray-400 text-sm">
                    {isAILoading 
                      ? "GENIE AI is now synthesizing your HTML, CSS, and interactive logic based on the refined prompts."
                      : (isDarkMode ? "Initialize the automated deployment sequence or launch manually." : "Head over to Google AI Studio Build or run it here automatically.")}
                  </p>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                  {!generatedCode ? (
                    <button
                      onClick={automatedWebsiteGeneration}
                      disabled={isAILoading}
                      style={{ backgroundColor: 'oklch(0.546 0.245 262.881)' }}
                      className={`flex-1 sm:flex-initial flex items-center justify-center gap-3 py-4 px-8 rounded-2xl font-bold transition-all shadow-lg text-white hover:opacity-90 shadow-blue-500/10 ${isAILoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <Sparkles className={`w-5 h-5 ${isAILoading ? 'animate-spin' : ''}`} /> 
                      <span className="flex items-center gap-2">
                        {isAILoading ? "Building..." : "Run Automatically"}
                        {!isAILoading && (
                          <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider">beta</span>
                        )}
                      </span>
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setView("ppt-preview")}
                        className={`flex-1 sm:flex-initial flex items-center justify-center gap-3 py-4 px-8 rounded-2xl font-bold transition-all shadow-lg ${isDarkMode ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-500/10' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-black/10'}`}
                      >
                        <Eye className="w-5 h-5" /> View Synthesis
                      </button>
                      <button
                        onClick={() => setGeneratedCode("")}
                        className={`flex items-center justify-center p-4 rounded-2xl font-bold transition-all border ${isDarkMode ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-800' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                        title="Dismiss Synthesis & Reset"
                      >
                        <RefreshCw className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                  
                  <a 
                    href="https://aistudio.google.com/build"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 sm:flex-initial flex items-center justify-center gap-3 py-4 px-8 rounded-2xl font-bold hover:scale-105 active:scale-95 transition-all shadow-lg ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-white text-black shadow-black/10'}`}
                  >
                    Launch AI Studio Build <ExternalLink className="w-5 h-5" />
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-12 text-center">
              <button 
                onClick={() => setView("ppt-summary-preview")}
                className={`font-semibold transition-colors ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}
              >
                Back to Content Summary
              </button>
            </div>
          </motion.div>
        ) : view === "ppt-preview" ? (
          <motion.div
            key="ppt-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`min-h-screen py-12 px-4 transition-colors ${isDarkMode ? 'bg-zinc-950' : 'bg-gray-50'}`}
          >
            <div className="max-w-6xl mx-auto">
              <header className="flex flex-col md:flex-row justify-between items-center gap-6 mb-12">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setView("dashboard")}
                    className={`p-3 border rounded-2xl transition-all ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-white' : 'bg-white border-gray-100 text-gray-400 hover:text-black'}`}
                  >
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                  <div>
                    <h2 className={`text-3xl font-display font-medium ${isDarkMode ? 'text-white' : 'text-black'}`}>Website Preview</h2>
                    <p className="text-gray-400">Review your presentation as a modern landing page.</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-4">
                  {!generatedCode ? (
                    <>
                    <button
                      onClick={() => setIsLiked(!isLiked)}
                      className={`flex items-center gap-2 py-4 px-8 rounded-2xl font-bold transition-all ${isLiked ? 'bg-pink-500 text-white shadow-lg shadow-pink-200' : (isDarkMode ? 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-pink-400 hover:border-pink-500/30' : 'bg-white text-gray-400 border border-gray-100 hover:border-pink-200 hover:text-pink-500')}`}
                    >
                      <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
                      {isLiked ? "Liked!" : "Like Logic"}
                    </button>

                    <button
                      onClick={exportToPDF}
                      className={`flex items-center gap-2 py-4 px-8 rounded-2xl font-bold transition-all hover:scale-105 active:scale-95 shadow-xl ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-black text-white shadow-black/10'}`}
                    >
                      <Download className="w-5 h-5" />
                      Download PDF
                    </button>

                    <button
                      onClick={downloadNotes}
                      className={`flex items-center gap-2 border py-4 px-8 rounded-2xl font-bold transition-all ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-blue-400 hover:bg-zinc-700' : 'bg-white text-blue-600 border-blue-100 hover:bg-blue-50'}`}
                    >
                      <FileText className="w-5 h-5" />
                      Notes PDF
                    </button>

                    <button
                      onClick={handleFinalizePPTX}
                      className={`flex items-center gap-2 border py-4 px-8 rounded-2xl font-bold transition-all ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white' : 'bg-white text-gray-400 border border-gray-100 hover:border-gray-200 hover:text-black'}`}
                    >
                      <FileOutput className="w-5 h-5" />
                      PPTX
                    </button>
                    </>
                  ) : (
                    <button
                      onClick={exportToPDF}
                      className={`flex items-center gap-2 py-4 px-8 rounded-2xl font-bold transition-all hover:scale-105 active:scale-95 shadow-xl ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-black text-white shadow-black/10'}`}
                    >
                      <Download className="w-5 h-5" />
                      Download Artifact
                    </button>
                  )}
                </div>
              </header>

              <div ref={previewRef} className="space-y-12 h-full flex flex-col lg:flex-row gap-6">
                {generatedCode ? (
                  <>
                  <div className={`relative flex-1 rounded-[32px] overflow-hidden border border-gray-200 dark:border-zinc-800 bg-white transition-all duration-500 ${isFullscreen ? 'fixed inset-0 z-[100] rounded-none' : 'h-[80vh]'}`}>
                    {isFullscreen && (
                      <button 
                        onClick={() => setIsFullscreen(false)}
                        className="absolute top-6 right-6 z-10 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full backdrop-blur-md transition-all border border-white/20"
                      >
                        <Minimize2 className="w-6 h-6" />
                      </button>
                    )}
                    {!isFullscreen && (
                      <button 
                        onClick={() => setIsFullscreen(true)}
                        className="absolute top-6 right-6 z-10 bg-blue-600/90 hover:bg-blue-600 text-white p-3 rounded-2xl shadow-xl transition-all border border-blue-400/20"
                      >
                        <Maximize2 className="w-5 h-5" />
                      </button>
                    )}
                    <iframe
                      title="AI Synthesis Preview"
                      srcDoc={injectedCode}
                      className="w-full h-full border-none"
                      sandbox="allow-scripts allow-modals allow-downloads allow-forms"
                    />
                  </div>

                  <div className={`w-full lg:w-96 flex flex-col gap-4 ${isFullscreen ? 'hidden' : ''}`}>
                    {/* Console Box */}
                    <div className={`flex-1 rounded-[24px] border transition-all overflow-hidden flex flex-col ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-gray-50 border-gray-100'}`}>
                      <div className="px-5 py-3 border-b border-inherit flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                          <Terminal className="w-4 h-4 text-blue-500" /> Console
                        </span>
                        <button onClick={() => setConsoleLogs([])} className="text-[10px] text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">Clear</button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-2">
                        {consoleLogs.some(l => l.type === 'error') && (
                          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex flex-col gap-2">
                            <div className="font-bold flex items-center gap-2">
                              <Info className="w-3 h-3" /> Error Detected
                            </div>
                            <p className="opacity-80">The preview encountered an error. You can ask the AI to fix it below.</p>
                            <button 
                              onClick={() => setIterativePrompt(`The console reported the following errors:\n${consoleLogs.filter(l => l.type === 'error').map(l => l.message).join('\n')}\n\nPlease fix these errors in the code.`)}
                              className="text-[10px] bg-red-500 text-white py-1.5 px-3 rounded-md font-bold hover:bg-red-600 transition-all self-start"
                            >
                              Auto-fill Fix Prompt
                            </button>
                          </div>
                        )}
                        {consoleLogs.length === 0 ? (
                          <div className="text-gray-400 italic">No logs captured...</div>
                        ) : (
                          consoleLogs.map((log, i) => (
                            <div key={i} className={`flex gap-2 ${log.type === 'error' ? 'text-red-500' : log.type === 'warn' ? 'text-yellow-600' : 'text-gray-600 dark:text-gray-400'}`}>
                              <span className="shrink-0 opacity-50">[{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                              <span className="break-all">{log.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Chat Iteration Box */}
                    <div className={`rounded-[24px] border p-4 flex flex-col gap-3 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100 shadow-sm'}`}>
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-500">
                        <Wand2 className="w-4 h-4" /> Modify with AI
                      </div>
                      <textarea
                        value={iterativePrompt}
                        onChange={(e) => setIterativePrompt(e.target.value)}
                        placeholder="e.g. Change the button color to red or fix the alignment..."
                        className={`w-full h-24 p-3 text-sm rounded-xl border resize-none focus:ring-2 focus:ring-blue-500 outline-none transition-all ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-white' : 'bg-white border-gray-200'}`}
                      />
                      <button
                        onClick={handleIterativeGeneration}
                        disabled={isIterating || !iterativePrompt.trim()}
                        className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${isIterating ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'}`}
                      >
                        {isIterating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        {isIterating ? 'Applying Changes...' : 'Update Website'}
                      </button>
                    </div>
                  </div>
                  </>
                ) : slidesData.slice(0, pptConfig.slides).map((slide, index) => (
                  <div
                    key={index}
                    className={`slide-render-target relative border rounded-[48px] overflow-hidden shadow-sm aspect-video md:aspect-[21/9] lg:aspect-[2.4/1] transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}
                    style={{ 
                      backgroundColor: pptConfig.theme === 'dark' ? '#1a1a1a' : (pptConfig.theme === 'light' ? '#ffffff' : undefined),
                      color: pptConfig.theme === 'dark' ? '#ffffff' : '#000000'
                    }}
                  >
                    <div className="absolute inset-0 flex flex-col md:flex-row">
                      <div className="flex-1 p-8 md:p-16 flex flex-col justify-center">
                        <span className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4">Slide 0{index + 1}</span>
                        <h3 className="text-3xl md:text-5xl lg:text-6xl font-display font-medium leading-tight mb-8">
                          {slide.title || "Untitled Slide"}
                        </h3>
                        <p className="text-lg md:text-xl lg:text-2xl font-light leading-relaxed max-w-2xl opacity-80">
                          {slide.text}
                        </p>
                      </div>
                      
                      {(slide.mediaUrl && slide.mediaType === 'image') && (
                        <div className="hidden md:block w-1/3 lg:w-2/5 relative">
                          <img 
                            src={slide.mediaUrl}
                            alt="Slide media"
                            className="absolute inset-0 w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <footer className="mt-20 py-12 text-center text-gray-400 border-t border-gray-100">
                <p className="font-display text-sm tracking-widest uppercase">End of Presentation Preview</p>
              </footer>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="ppt-final"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative max-w-2xl mx-auto px-6 py-24 text-center"
          >
            <div className="mb-12 relative flex justify-center">
              <div className="bg-blue-500 text-white p-8 rounded-[40px] shadow-2xl relative z-10">
                {isGenerating ? (
                  <RefreshCw className="w-16 h-16 animate-spin" />
                ) : (
                   <CheckCircle2 className="w-16 h-16" />
                )}
              </div>
              <div className="absolute inset-0 bg-[rgba(59,130,246,0.2)] blur-[60px] animate-pulse" />
            </div>

            <h2 className={`text-5xl font-display font-medium mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {isGenerating ? "Synthesizing..." : "Presentation Ready!"}
            </h2>
            <p className={`text-xl font-light mb-12 max-w-md mx-auto ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
              {isGenerating 
                ? "Our AI engine is compiling your content, optimizing layouts, and generating a high-fidelity PDF document."
                : "Your PDF presentation has been generated and the download should start automatically."}
            </p>

            <div className="flex flex-col gap-4">
              {!isGenerating && (
                <div className="flex flex-col gap-4 w-full">
                  <button
                    onClick={exportToPDF}
                    className={`py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-xl ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-black text-white shadow-black/10'}`}
                  >
                    <Download className="w-5 h-5" /> Download PDF Again
                  </button>
                  <button
                    onClick={downloadNotes}
                    className="bg-blue-600 text-white py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
                  >
                    <FileText className="w-5 h-5" /> Download Notes (PDF)
                  </button>
                  <button
                    onClick={handleFinalizePPTX}
                    className={`py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${isDarkMode ? 'bg-zinc-800 border border-zinc-700 text-white hover:bg-zinc-700' : 'bg-gray-100 text-black hover:bg-gray-200'}`}
                  >
                    <FileOutput className="w-5 h-5" /> Export as PPTX instead
                  </button>
                </div>
              )}
              <button
                onClick={handleReset}
                className={`font-semibold py-4 transition-colors ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}
              >
                Create another presentation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}




