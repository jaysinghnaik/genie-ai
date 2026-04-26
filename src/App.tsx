/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ChangeEvent, FormEvent, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import pptxgen from "pptxgenjs";
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Presentation, FileText, Sparkles, ArrowRight, Github, ChevronLeft, 
  Layout, Palette, Moon, Sun, Hash, Wand2, Image as ImageIcon, 
  Video, Play, Pause, ChevronRight, CheckCircle2, Download, RefreshCw,
  Loader2, Eye, EyeOff, FileOutput, Heart, Copy, ExternalLink, Terminal,
  Settings as SettingsIcon, Info, UserCircle, X, Battery, Key, ShieldCheck, Check, Lock, LogOut,
  Upload, Paperclip, File, Trash2
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
    description: "Convert ideas into conference-ready IEEE formatted research papers automatically.",
    icon: <FileText className="w-8 h-8 text-emerald-500" />,
    color: "from-emerald-500/20 to-teal-500/20",
    borderColor: "hover:border-emerald-500/50",
    tag: "Scientific"
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
  const [isExporting, setIsExporting] = useState(false);
  const [selectedApp, setSelectedApp] = useState<string>("ppt-maker");
  const [references, setReferences] = useState<string[]>([]);

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
    const isIEEE = selectedApp === "ieee-maker";
    const systemPrompt = isIEEE 
      ? `You are an expert academic researcher and LaTeX/Web formatter. Your goal is to generate a conference-ready research paper adhering strictly to IEEE standards.

STRICT IEEE FORMATTING RULES:
1. Double Column Layout: Use a two-column grid (grid-cols-2) for the main body. Title and Abstract MUST span both columns (col-span-2).
2. Typography: Use "Times New Roman", serif for all text. Body text: 10pt (0.875rem), Title: 24pt (1.5rem and bold), Section Headings: 10pt All-Caps or Small-Caps.
3. Citations: Use bracketed numbers [1], [2] in text. References must be a separate section at the end, numbered by order of appearance.
4. Figures & Tables: Figure captions MUST be below the figure (e.g., Fig. 1. Description). Table titles MUST be above (e.g., TABLE I. Title in Small-Caps).
5. Math: Center equations on their own line with a right-aligned parenthetical number (1).
6. Alignment: Body text MUST be justified (text-justify).
7. Sections: Follow standard IEEE structure: Title, Authors (use placeholders), Abstract, Index Terms, I. Introduction, II. Related Work, III. Methodology, IV. Results, V. Conclusion, References.

Output ONLY the final code block (usually HTML/Tailwind). Use a white background style that looks like a printed paper.`
      : `You are a world-class presentation designer and web developer. Your goal is to create a high-fidelity, professional presentation as a responsive web experience.

STRICT VERTICAL CONTAINMENT RULES:
1. Viewport Locking: Every slide container (.slide-render-target) MUST have overflow: hidden; and display: flex; flex-direction: column;. This ensures no content leaks into the next page.
2. The 80% Rule: Content must only occupy the top 80% of the 1080px (simulated) height. The bottom 200px must be reserved for footers and "breathing room" to prevent clipping at the PDF edge.
3. Auto-Scaling Text: Use CSS clamp() for font sizes. This ensures that if the content is slightly longer, the font shrinks to fit the container.
4. Content Distillation: If a technical explanation exceeds 45 words, you MUST summarize it into 3 bullet points. No 'Wall of Text' allowed.
5. Grid Geometry: Use strict grid layouts for content cards (e.g., grid-template-rows: repeat(2, 1fr)) to keep cards in their quadrants regardless of text length.
6. Design Aesthetic: Use a modern, high-contrast palette. Preferred fonts: Inter, JetBrains Mono for technical data.

Output ONLY the final code block (usually HTML/Tailwind).`;

    const parts: any[] = [
      { text: systemPrompt }
    ];

    parts.push(...uploadedFiles.map(file => ({
      inlineData: {
        mimeType: file.mimeType,
        data: file.data
      }
    })));

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
    setGeneratedCode(""); // Clear previous synthesis to avoid stale state
    setView("ppt-topic-entry");
  };

  const handleTopicSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    
    setGeneratedCode(""); // Double safety: ensure code is cleared when topic is submitted
    const isIEEE = selectedApp === "ieee-maker";
    const fileContext = uploadedFiles.length > 0 ? ` Please use the provided attached files (knowledge base) as primary reference material for the content.` : "";
    
    const prompt = isIEEE
      ? `Provide a list of exactly ${Math.max(1, pptConfig.slides - 1)} major core research section titles (e.g., Methodology, Literature Review, results, etc.) for an IEEE conference paper about: "${topic}". 
         
         RULES:
         - DO NOT write the paper yet.
         - DO NOT include Abstract, Keywords, Introduction, Conclusion, or References.
         - Output ONLY the list of titles, one per line.
         - No numbers, no bullet points, no markdown, no conversational text.
         - Example output:
         Literature Review
         Proposed Methodology
         Experimental Results`
      : `I want to create a professional presentation about: "${topic}".${fileContext} Provide exactly ${pptConfig.slides} distinct sub-topics for the slides. Format each sub-topic on a new line and DO NOT include numbers or bullet points. Output ONLY the titles. Absolutely no introductory or concluding text. Just the titles.`;
    
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
      
      if (chunks.length > 0 && ragService && selectedApp !== 'ieee-maker') {
        // RAG Pipeline for presentations
        const subtopic = subtopics[activeSubtopicIndex];
        const relevantChunks = await ragService.retrieveRelevantChunks(chunks, subtopic);
        const contextString = await ragService.reduceTokens(relevantChunks);
        
        let slideData = await ragService.generateSlide(subtopic, contextString);
        const verification = await ragService.verifySlideDetailed(slideData, contextString);
        
        if (verification.score < 7) {
          slideData = await ragService.regenerateSlideSmart(subtopic, contextString, verification.issues);
        }
        
        finalContent = `${slideData.title}\n\n${slideData.points.map((p: any) => `• ${typeof p === 'string' ? p : p.text}`).join("\n")}`;
      } else {
        // Core Section Generation for IEEE or standard PPT flow without RAG
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
        { text: `${currentPrompt}\n\nIMPORTANT:
1. Follow the STRICT VERTICAL CONTAINMENT RULES provided in the system instruction.
2. Do NOT include any "Export to PDF" or "Download PDF" buttons or scripts.
3. Use Tailwind CSS for 100% of styling.
4. Output ONLY the code block.` }
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
        { text: `Currently, the website code is as follows:\n\n${generatedCode}\n\nUser request for changes: "${iterativePrompt}"\n\nIMPORTANT:
1. Maintain all STRICT VERTICAL CONTAINMENT RULES.
2. Output ONLY the updated FULL code block (Tailwind + HTML).` }
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

          // Listen for HTML requests from parent (used for PDF export of edited content)
          window.addEventListener('message', (e) => {
            if (e.data?.type === 'request-html-sync') {
              window.parent.postMessage({
                type: 'response-html-sync',
                html: document.documentElement.outerHTML
              }, '*');
            }
          });
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
    
    // Clean up buffer from common AI artifacts
    const cleanBuffer = aiPasteBuffer
      .replace(/```[a-z]*\n/g, '')
      .replace(/```/g, '')
      .replace(/<[^>]*>?/gm, '') // Remove HTML tags if any
      .trim();

    const extracted = cleanBuffer.split('\n')
      .map(line => line.replace(/^\d+\.\s*|-\s*/, '').trim())
      .filter(line => line.length > 0 && !line.endsWith(':') && line.length < 100 && !line.toLowerCase().includes('here is') && !line.toLowerCase().includes('section titles'))
      .slice(0, selectedApp === "ieee-maker" ? Math.max(1, pptConfig.slides - 1) : pptConfig.slides);
    
    if (extracted.length === 0) return;
    
    setSubtopics(extracted);
    setActiveSubtopicIndex(0);
    setAiPasteBuffer("");
    setReferences([]); // Reset references for new paper
    
    const isIEEE = selectedApp === "ieee-maker";
    const firstSubtopicPrompt = isIEEE
      ? `Draft the research section "${extracted[0]}" for an IEEE paper about "${topic}". 
         REQUIREMENTS:
         1. Word Count: Total 600-1000 words. 
         2. Structure: If the topic has two distinct parts, use sub-headings (e.g., A. First Part, B. Second Part) with 300-500 words each. Otherwise, provide one continuous technical deep-dive.
         3. Tone: Formal academic, technical, and precise.
         4. Citations: Use placeholders [1], [2], etc.
         5. References: At the very end of your response, provide a list of full academic references for any facts used, starting with the exact header "REFERENCES:".`
      : `Explain the sub-topic "${extracted[0]}" for a presentation about "${topic}". Provide a clear, engaging slide title and exactly 4 detailed bullet points summarizing the key aspects of this sub-topic.`;
    
    setCurrentPrompt(firstSubtopicPrompt);
    setView("ppt-subtopic-entry");
  };

  const handleSubtopicProcess = () => {
    if (!aiPasteBuffer.trim()) return;
    
    const isIEEE = selectedApp === "ieee-maker";
    let bodyText = aiPasteBuffer;
    
    if (isIEEE) {
      // Extract references if they exist
      const refMatch = aiPasteBuffer.match(/REFERENCES:([\s\S]*)$/i);
      if (refMatch) {
         const newRefs = refMatch[1].split('\n')
           .map(r => r.trim())
           .filter(r => r.length > 5);
         setReferences(prev => {
           const combined = [...prev, ...newRefs];
           // Remove duplicates while keeping order
           return combined.filter((item, pos) => combined.indexOf(item) === pos);
         });
         // Strip references from body text for display
         bodyText = aiPasteBuffer.split(/REFERENCES:/i)[0].trim();
      }
    }

    setSlidesData(prev => {
      const newData = [...prev];
      newData[activeSubtopicIndex] = {
        ...newData[activeSubtopicIndex],
        title: subtopics[activeSubtopicIndex],
        text: bodyText,
        mediaType: 'none',
        mediaUrl: ''
      };
      return newData;
    });

    if (activeSubtopicIndex < subtopics.length - 1) {
      const nextIndex = activeSubtopicIndex + 1;
      setActiveSubtopicIndex(nextIndex);
      setAiPasteBuffer("");
      const nextPrompt = isIEEE
        ? `Draft the research section "${subtopics[nextIndex]}" for an IEEE paper about "${topic}". 
           REQUIREMENTS:
           1. Word Count: Total 600-1000 words. 
           2. Structure: If the topic has two distinct parts, use sub-headings (e.g., A. First Part, B. Second Part) with 300-500 words each.
           3. Citations: Use placeholders [1], [2], etc. continuing the sequence from previous sections.
           4. References: At the very end of your response, provide a list of full academic references for any facts used, starting with the exact header "REFERENCES:".`
        : `Explain the sub-topic "${subtopics[nextIndex]}" for a presentation about "${topic}". Provide a clear, engaging slide title and exactly 4 detailed bullet points summarizing the key aspects of this sub-topic.`;
      
      setCurrentPrompt(nextPrompt);
    } else {
      setView("ppt-summary-preview");
      setAiPasteBuffer("");
    }
  };

  const generateFinalPrompt = () => {
    const isIEEE = selectedApp === "ieee-maker";
    let contentStr = slidesData.slice(0, subtopics.length).map((s, i) => `${isIEEE ? 'Section' : 'Slide'} ${i + 1}: ${s.title}\nContent: ${s.text}`).join('\n\n');
    
    const paperRequirements = `IEEE MANUSCRIPT REQUIREMENTS & PRINT PROTOCOL:
1. FULL EDITABILITY:
   - Wrap ALL text blocks (Title, Authors, Abstract, Section Headings, Paragraphs) in <div contentEditable="true" class="hover:bg-blue-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 rounded p-1 transition-all">.
2. DYNAMIC FIGURE SLOTS (ONE PER SECTION):
   - At the bottom of every major section (e.g., Introduction, Methodology), provide a figure placeholder:
     <div class="figure-slot border-2 border-dashed border-gray-200 rounded-lg p-8 my-6 text-center no-print">
       <div class="figure-controls flex items-center justify-center gap-4">
         <button onclick="this.closest('.figure-slot').querySelector('input').click()" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-all flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg> Insert Figure
         </button>
         <button onclick="this.closest('.figure-slot').remove()" class="text-gray-400 hover:text-red-500 p-2 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
         </button>
       </div>
       <input type="file" accept="image/*" class="hidden" onchange="const slot=this.closest('.figure-slot'); const img=document.createElement('img'); img.src=URL.createObjectURL(this.files[0]); img.className='w-full h-auto rounded-lg mb-2'; slot.innerHTML=''; slot.appendChild(img); slot.classList.remove('no-print'); slot.classList.add('has-image'); const cap=document.createElement('div'); cap.contentEditable='true'; cap.className='text-center text-[8pt] italic'; cap.innerText='Fig. X. Description'; slot.appendChild(cap);">
       <p class="text-[8px] text-gray-400 mt-2">Placeholder: Will be hidden in final PDF if ignored.</p>
     </div>
3. PRINT FIDELITY (ZERO WATERMARK):
   - CRITICAL: NO "Download as PDF" button should be rendered inside the '.paper-container'.
   - Use @media print to hide EVERYTHING interactive.
   - CSS Requirements: 
     @media print { 
        .no-print, .figure-slot:not(.has-image), button, input { display: none !important; } 
        body { background: white !important; padding: 0 !important; margin: 0 !important; }
        .paper-container { margin: 0 !important; box-shadow: none !important; width: 100% !important; padding: 0.5in !important; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
     }
4. ABSTRACT & KEYWORDS (META GENERATION): 
   - Based on the core sections provided, synthesize a 150-250 word Abstract. 
   - Include 3-5 relevant Index Terms (Keywords).
5. INTRODUCTION & CONCLUSION (SYNTHESIS):
   - You MUST generate a formal "I. INTRODUCTION" section (400-600 words) as the first body section.
   - You MUST generate a formal "CONCLUSION" section (200-300 words) as the last body section.
   - Core research sections provided because context must follow the Introduction and be numbered correctly (II, III, IV, etc.).
6. ACKNOWLEDGMENTS: Include a brief Acknowledgments section after the conclusion.
7. REFERENCES (BIBLIOGRAPHY): 
   - Use the exact "REFERENCES:" data collected during the research phase.
   - List them in a final "References" section at the end of the paper using IEEE numeric format [1], [2], etc.
8. DOUBLE COLUMN LAYOUT: Use grid-cols-2 for the main body. Title and Abstract MUST span both columns (col-span-2).
9. TYPOGRAPHY: Use "Times New Roman", serif. Body: 10pt (0.875rem), Title: 24pt (1.5rem, bold), Section Headings: 10pt (bold/caps).
10. ALIGNMENT: Body text MUST be justified (text-justify).`;

    const slideRequirements = `Presentation Content Requirements:
1. Design & Color Protocol (STRICT HEX ENFORCEMENT): 
   - Use ONLY 6-digit hex codes (e.g., #111827 for dark backgrounds) and standard RGBA. 
   - Modern oklch/oklab colors are STRICTLY FORBIDDEN.
   - REMOVE ALL Tailwind opacity modifiers (e.g., bg-white/10). Use explicit rgba().
2. STRICT VERTICAL CONTAINMENT: 
   - EACH slide MUST use the class 'slide-render-target'. It must fill exactly one 1920x1080 viewport.
   - INTERNAL STRUCTURE: Inside 'slide-render-target', use a div with class 'slide-content-area' for the main content (title + grid/body).
   - THE 80% RULE: Content must strictly stay within 'slide-content-area' (fixed at 864px height). This prevents content from leaking into the footer or next slide.
   - THE FOOTER ZONE: Reserve the bottom 216px (the 'slide-footer-area' class) for slide numbers or empty space.
3. GRID GEOMETRY: 
   - For multi-card layouts, use a div with class 'slide-grid'. 
   - It MUST use 'grid-template-rows: repeat(2, 1fr);' and 'grid-template-columns: repeat(2, 1fr);' to force a 4-quadrant layout. This ensures no content leaks vertically.
4. Typography: Use CSS clamp() indirectly via the classes 'slide-title', 'slide-subtitle', and 'slide-body' to allow auto-scaling.
5. Content Distillation: MANDATORY. If any card or section exceeds 45 words, summarize into 3 bullet points. No 'Wall of Text' allowed.
`;

    const prompt = `I want to build a high-fidelity, professional ${isIEEE ? 'IEEE Research Paper' : 'website presentation'} based on the following content.

Main Topic: ${topic}

${isIEEE ? 'PAPER CONTENT (Core Sections):' : 'Presentation Content:'}
${contentStr} 

${isIEEE ? `COLLECTED REFERENCES FOUND DURING RESEARCH:\n${references.join('\n')}\n` : ''}

STRICT REQUIREMENTS:
${isIEEE ? paperRequirements : slideRequirements}
6. Feature: Add a prominent "Download as PDF" button.
7. Functionality: CRITICAL - Use the "Native Print" method (window.print()) to export as PDF. 
   - Design for @media print to ensure perfect ${isIEEE ? 'Letter size (8.5x11)' : '16:9 slide'} formatting.
   - Ensure each ${isIEEE ? 'page' : 'slide'} has 'page-break-after: always'.
8. STABILITY: 
   - Animations, transitions, and unintended layout shifts are STRICTLY FORBIDDEN.
   - The rendered HTML must be static and stable for high-fidelity capture.
9. Icon Protocol: For "Storage" or power related sections, use a proper Battery icon.

IMPORTANT: Stated strictly: Use ONLY 6-digit hex codes and standard RGBA. No modern color formats. ${isIEEE ? 'Layout must be professional white paper format.' : 'Each slide must be a perfect 16:9 rectangle.'}`;

    setCurrentPrompt(prompt);
    setView("ppt-generation-prompt");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const exportToPDF = async () => {
    let htmlToPrint = injectedCode;
    
    try {
       // Request latest HTML from iframe
       htmlToPrint = await new Promise<string>((resolve) => {
         const timeout = setTimeout(() => {
           window.removeEventListener('message', handleSync);
           resolve(injectedCode);
         }, 1000);

         const handleSync = (event: MessageEvent) => {
           if (event.data?.type === 'response-html-sync') {
             clearTimeout(timeout);
             window.removeEventListener('message', handleSync);
             resolve(event.data.html);
           }
         };

         window.addEventListener('message', handleSync);
         const iframe = document.querySelector('iframe');
         iframe?.contentWindow?.postMessage({ type: 'request-html-sync' }, '*');
       });
    } catch (e) {
      console.warn("Failed to sync HTML for legacy print", e);
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert("Please allow pop-ups to download your presentation PDF.");
      return;
    }

    // Inject standard RGB colors and 16:9 Print CSS
    printWindow.document.write(`
      <html>
        <head>
          <title>${topic || 'Genie AI Presentation'}</title>
          <style>
            @media print {
              @page { size: 1920px 1080px landscape; margin: 0; }
              body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .slide-render-target, section, .slide { 
                 page-break-after: always; height: 1080px; width: 1920px; 
                 overflow: hidden; display: block !important;
              }
            }
          </style>
        </head>
        <body>${htmlToPrint}</body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => { 
      printWindow.print(); 
      printWindow.close(); 
    }, 4000);
    setView("ppt-final");
  };

  const exportToHighFidelityPDF = async () => {
    if (!generatedCode) return;
    setIsExporting(true);
    
    try {
      // Request latest HTML from iframe to capture manual contentEditable changes
      const latestHTML = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          window.removeEventListener('message', handleSyncResponse);
          reject(new Error("Timeout waiting for iframe sync"));
        }, 3000);

        const handleSyncResponse = (event: MessageEvent) => {
          if (event.data?.type === 'response-html-sync') {
            clearTimeout(timeout);
            window.removeEventListener('message', handleSyncResponse);
            resolve(event.data.html);
          }
        };

        window.addEventListener('message', handleSyncResponse);
        const iframe = document.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ type: 'request-html-sync' }, '*');
        } else {
          clearTimeout(timeout);
          window.removeEventListener('message', handleSyncResponse);
          resolve(injectedCode); // Fallback to current state
        }
      });

      const response = await fetch('/api/render-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: latestHTML,
          width: pptConfig.ratio === '16:9' ? 1920 : 1080,
          height: pptConfig.ratio === '16:9' ? 1080 : 1920,
          theme: isDarkMode ? 'dark' : 'light'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = topic ? topic.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'presentation';
      a.download = `${fileName}_high_fidelity.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      console.error("PDF Export Error:", error);
      alert(`High-fidelity export failed: ${error.message}. Falling back to native print.`);
      exportToPDF();
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenNewTab = () => {
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.document.write(injectedCode);
      newWindow.document.close();
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
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const notesContent = slidesData.slice(0, pptConfig.slides).map((s, i) => `
      <div style="margin-bottom: 30px; page-break-inside: avoid;">
        <h2 style="margin-bottom: 5px;">[SLIDE ${i + 1}] ${s.title || "Untitled"}</h2>
        <div style="white-space: pre-wrap;">${s.text || ""}</div>
      </div>
    `).join('');

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Notes: ${topic}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; line-height: 1.6; max-width: 800px; margin: 0 auto; }
            h1 { text-align: center; border-bottom: 2px solid #ccc; padding-bottom: 20px; margin-bottom: 40px; }
            h2 { color: #333; border-left: 4px solid #3b82f6; padding-left: 15px; }
          </style>
        </head>
        <body>
          <h1>PRESENTATION NOTES: ${topic.toUpperCase()}</h1>
          ${notesContent}
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 500);
            };
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const handleReset = () => {
    setView("dashboard");
    setIsLiked(false);
    setTopic("");
    setSubtopics([]);
    setActiveSubtopicIndex(0);
    setAiPasteBuffer("");
    setReferences([]); // Reset references
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
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ type: "spring", damping: 25, stiffness: 100 }}
              className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-16"
            >
              {/* Header Section */}
              <div className="mb-12 md:mb-20 text-center md:text-left">
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-blue-500/10 text-blue-500"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold tracking-[0.2em] uppercase">Intelligence Studio</span>
                </motion.div>

                <motion.h1
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className={`text-5xl md:text-8xl font-black tracking-tight mb-6 leading-none ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}
                >
                  GENIE <span className="text-blue-600 italic">AI</span>
                </motion.h1>
                
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className={`flex flex-col md:flex-row md:items-center justify-center md:justify-start gap-4 text-lg md:text-2xl ${isDarkMode ? 'text-zinc-500' : 'text-gray-400'}`}
                >
                  <span className="font-light italic">POWERED BY</span>
                  <span className={`font-black tracking-widest text-2xl md:text-4xl underline decoration-blue-500/30 underline-offset-8 decoration-4 ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
                    JAY SINGH NAIK
                  </span>
                </motion.div>
              </div>

              {/* Apps Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                {apps.map((app, index) => (
                  <motion.button
                    key={app.id}
                    onClick={() => {
                      if (app.id === "ppt-maker" || app.id === "ieee-maker") {
                        // Fully reset state before starting new app
                        setTopic("");
                        setSubtopics([]);
                        setActiveSubtopicIndex(0);
                        setAiPasteBuffer("");
                        setGeneratedCode("");
                        setReferences([]); // Reset references
                        setSlidesData(Array(20).fill(null).map(() => ({ title: "", text: "", mediaUrl: "", mediaType: "none" })));
                        
                        setSelectedApp(app.id);
                        
                        if (app.id === "ieee-maker") {
                          setView("ppt-topic-entry");
                          setIsDarkMode(false); // Force light mode for academic papers
                        } else {
                          setView("ppt-config");
                        }
                      }
                    }}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className={`group relative text-left border rounded-3xl p-8 md:p-12 transition-all duration-500 hover:shadow-2xl hover:shadow-blue-500/10 active:scale-[0.98] ${
                      (app.id === 'ppt-maker' || app.id === 'ieee-maker') ? 'cursor-pointer' : 'cursor-not-allowed opacity-80'
                    } ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-gray-100 shadow-sm'} ${app.borderColor}`}
                  >
                    <div className={`absolute inset-0 bg-gradient-to-br ${app.color} opacity-0 group-hover:opacity-20 transition-opacity duration-500`} />
                    
                    <div className="relative z-10 flex flex-col h-full">
                      <div className="flex items-start justify-between mb-8">
                        <div className={`p-4 rounded-xl shadow-sm border ${isDarkMode ? 'bg-zinc-800 border-zinc-700' : 'bg-gray-50 border-gray-100'}`}>
                          {app.icon}
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black tracking-widest uppercase ${isDarkMode ? 'bg-zinc-800 text-zinc-500' : 'bg-gray-100 text-gray-500'}`}>
                          {app.tag}
                        </span>
                      </div>
                      
                      <h3 className={`text-3xl font-black mb-4 group-hover:translate-x-1 transition-transform duration-300 ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
                        {app.title}
                      </h3>
                      
                      <p className={`text-base leading-relaxed mb-12 max-w-sm ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
                        {app.description}
                      </p>

                      <div className={`mt-auto flex items-center justify-between group/btn pt-8 border-t ${isDarkMode ? 'border-zinc-800' : 'border-gray-100'}`}>
                        <span className={`text-sm font-bold tracking-wide transition-colors ${isDarkMode ? 'text-zinc-600 group-hover:text-zinc-400' : 'text-gray-400 group-hover:text-zinc-900'}`}>
                          {(app.id === 'ppt-maker' || app.id === 'ieee-maker') ? 'Launch Studio' : 'Coming soon'}
                        </span>
                        <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full border flex items-center justify-center transition-all duration-300 transform group-hover:rotate-45 ${isDarkMode ? 'border-zinc-800 group-hover:border-white group-hover:bg-white group-hover:text-black' : 'border-gray-200 group-hover:border-black group-hover:bg-black group-hover:text-white'}`}>
                          <ArrowRight className="w-5 h-5" />
                        </div>
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
                  transition={{ delay: 0.6 }}
                  className="mt-20 md:mt-32"
                >
                  <div className="flex items-center gap-3 mb-8 md:mb-12">
                    <div className="p-2 rounded-lg bg-blue-500/10">
                      <RefreshCw className="w-5 h-5 text-blue-500 animate-spin-slow" />
                    </div>
                    <h2 className={`text-xl md:text-2xl font-black tracking-tight ${isDarkMode ? 'text-zinc-400' : 'text-gray-400'}`}>
                      RECENT CREATIONS
                    </h2>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {recentWorks.map((work) => (
                      <button
                        key={work.id}
                        onClick={() => {
                          setTopic(work.topic);
                          setGeneratedCode(work.code);
                          setView("ppt-preview");
                        }}
                        className={`group p-6 rounded-3xl border text-left transition-all hover:scale-[1.02] active:scale-95 ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700' : 'bg-white border-gray-100 hover:border-blue-200 shadow-sm'}`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className={`p-2 rounded-xl border ${isDarkMode ? 'bg-zinc-800 border-zinc-700 text-blue-400' : 'bg-blue-50 border-blue-100 text-blue-500'}`}>
                            <Eye className="w-4 h-4" />
                          </div>
                          <span className="text-[10px] text-gray-500 font-bold opacity-70">
                            {new Date(work.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <h4 className={`text-lg font-bold truncate mb-2 ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
                          {work.topic}
                        </h4>
                        <p className={`text-xs line-clamp-2 leading-relaxed h-8 ${isDarkMode ? 'text-zinc-500' : 'text-gray-500'}`}>
                          Full synthesized experience captured as high-fidelity output.
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-16"
          >
            <button
              onClick={() => setView("dashboard")}
              className={`flex items-center gap-2 transition-all mb-8 md:mb-12 group ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-zinc-900'}`}
            >
              <div className={`p-1.5 rounded-lg border transition-colors ${isDarkMode ? 'border-zinc-800 group-hover:bg-zinc-800' : 'border-gray-100 group-hover:bg-gray-50'}`}>
                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
              <span className="text-sm font-bold tracking-tight uppercase">Dashboard</span>
            </button>

            <header className="mb-12 md:mb-16">
              <h2 className={`text-4xl md:text-6xl font-black mb-4 tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
                Configure <span className="text-blue-600 italic">{selectedApp === 'ieee-maker' ? 'Manuscript' : 'Synthesis'}</span>
              </h2>
              <p className={`text-base md:text-xl font-medium leading-relaxed max-w-2xl ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
                Tailor your {selectedApp === 'ieee-maker' ? 'document' : 'presentation'} parameters. Our engine adapts the synthesis to your specific structural needs.
              </p>
            </header>

            <div className="space-y-12">
              {selectedApp !== 'ieee-maker' && (
                <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <div className="md:col-span-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <Layout className="w-5 h-5 text-blue-500" />
                      </div>
                      <h3 className={`font-black text-sm uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>Aspect Ratio</h3>
                    </div>
                    <p className="text-xs text-gray-400">Select the canvas geometry for your final artifact.</p>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-2 gap-4">
                    {[
                      { label: "16:9", sub: "Desktop", icon: <Presentation className="w-5 h-5" /> },
                      { label: "9:16", sub: "Mobile", icon: <Presentation className="w-5 h-5 rotate-90" /> }
                    ].map((r) => (
                      <button
                        key={r.label}
                        onClick={() => setPptConfig(prev => ({ ...prev, ratio: r.label }))}
                        className={`flex flex-col items-center justify-center p-6 md:p-8 rounded-3xl border-2 transition-all duration-300 ${pptConfig.ratio === r.label ? (isDarkMode ? 'border-blue-500 bg-blue-500/10 shadow-xl shadow-blue-500/10 text-white' : 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-600/10 text-blue-700') : (isDarkMode ? 'border-zinc-800 bg-zinc-900/50 text-zinc-600 hover:border-zinc-700' : 'border-gray-100 bg-gray-50/50 text-gray-400 hover:border-gray-200')}`}
                      >
                        <div className="mb-4 p-3 rounded-2xl bg-current opacity-10 flex items-center justify-center">
                          {r.icon}
                        </div>
                        <span className="font-black text-2xl mb-1">{r.label}</span>
                        <span className="text-[10px] uppercase font-bold tracking-[0.2em] opacity-60">{r.sub}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {selectedApp !== 'ieee-maker' && (
                <section className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12 border-t border-gray-100 dark:border-zinc-900">
                  <div className="md:col-span-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-indigo-500/10">
                        <Palette className="w-5 h-5 text-indigo-500" />
                      </div>
                      <h3 className={`font-black text-sm uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>Visual Theme</h3>
                    </div>
                    <p className="text-xs text-gray-400">Determines the core accessibility and mood palette.</p>
                  </div>
                  <div className="md:col-span-2 grid grid-cols-2 gap-4">
                    {[
                      { id: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
                      { id: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> }
                    ].map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setPptConfig(prev => ({ ...prev, theme: t.id }))}
                        className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all duration-300 ${pptConfig.theme === t.id ? (isDarkMode ? 'border-white bg-zinc-800 text-white' : 'border-zinc-900 bg-white text-zinc-900 shadow-lg shadow-zinc-900/10') : (isDarkMode ? 'border-zinc-800 bg-zinc-900/50 text-zinc-600 hover:border-zinc-700' : 'border-gray-100 bg-gray-50/50 text-gray-400 hover:border-gray-200')}`}
                      >
                        <div className={`p-2 rounded-lg ${pptConfig.theme === t.id ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white') : (isDarkMode ? 'bg-zinc-800' : 'bg-gray-100')}`}>
                          {t.icon}
                        </div>
                        <span className="font-black text-sm uppercase tracking-widest">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {selectedApp !== 'ieee-maker' && (
                <section className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-12 border-t border-gray-100 dark:border-zinc-900">
                  <div className="md:col-span-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-orange-500/10">
                        <Hash className="w-5 h-5 text-orange-500" />
                      </div>
                      <h3 className={`font-black text-sm uppercase tracking-widest ${isDarkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
                        {selectedApp === 'ieee-maker' ? 'Section Count' : 'Volume'}
                      </h3>
                    </div>
                    <p className="text-xs text-gray-400">
                      {selectedApp === 'ieee-maker' ? 'Define the depth of your research manuscript.' : 'Control the total synthesis scope of the presentation.'}
                    </p>
                  </div>
                  <div className="md:col-span-2 flex items-center gap-4 md:gap-8 p-6 rounded-3xl border transition-all ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800 shadow-inner' : 'bg-gray-50 border-gray-100 shadow-inner'} h-24 md:h-28">
                    <div className="flex-1 space-y-4">
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={pptConfig.slides}
                        onChange={(e) => setPptConfig(prev => ({ ...prev, slides: parseInt(e.target.value) }))}
                        className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer transition-all ${isDarkMode ? 'accent-white bg-zinc-800' : 'accent-zinc-900 bg-gray-300'}`}
                      />
                      <div className="flex justify-between text-[10px] font-black tracking-widest text-gray-400 uppercase">
                        <span>1 {selectedApp === 'ieee-maker' ? 'Section' : 'Slide'}</span>
                        <span>20 {selectedApp === 'ieee-maker' ? 'Sections' : 'Slides'}</span>
                      </div>
                    </div>
                    <div className={`w-20 h-16 md:w-24 md:h-20 rounded-2xl flex items-center justify-center bg-white shadow-lg border-2 ${isDarkMode ? 'border-white bg-zinc-950' : 'border-zinc-900 bg-white'}`}>
                      <span className={`text-3xl md:text-4xl font-black ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>{pptConfig.slides}</span>
                    </div>
                  </div>
                </section>
              )}

              <motion.section
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="pt-16 md:pt-20"
              >
                <div className="text-center mb-10 md:mb-12">
                  <p className={`text-sm md:text-base font-medium max-w-lg mx-auto ${isDarkMode ? 'text-zinc-500' : 'text-gray-400'}`}>
                    Finalize your configuration to initiate the synthesis. GENIE AI will create a coherent logical structure for your {selectedApp === 'ieee-maker' ? 'manuscript' : 'presentation'}.
                  </p>
                </div>
                
                <button
                  onClick={handleContentTypeSelect}
                  className={`w-full group p-6 md:p-10 rounded-[2.5rem] border-2 transition-all duration-500 flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden hover:scale-[1.02] active:scale-95 shadow-2xl ${isDarkMode ? 'border-white bg-white text-black shadow-white/5' : 'border-zinc-900 bg-zinc-900 text-white shadow-black/20'}`}
                >
                  <div className="flex flex-col md:flex-row items-center gap-6 md:gap-8 text-center md:text-left">
                    <div className={`p-5 rounded-3xl transition-all group-hover:scale-110 group-hover:rotate-6 ${isDarkMode ? 'bg-zinc-100' : 'bg-white/10'}`}>
                      <Wand2 className={`w-8 h-8 md:w-10 md:h-10 ${isDarkMode ? 'text-blue-600' : 'text-blue-400'}`} />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-2xl md:text-3xl font-black">Synthesize with AI</h4>
                      <p className={`text-sm leading-relaxed max-w-sm ${isDarkMode ? 'text-zinc-500' : 'text-white/40'}`}>
                        Unlock automated content generation with high-fidelity formatting.
                      </p>
                    </div>
                  </div>
                  <div className={`flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full transition-all group-hover:translate-x-2 ${isDarkMode ? 'bg-zinc-100' : 'bg-white/10'}`}>
                    <ArrowRight className="w-6 h-6 md:w-8 md:h-8" />
                  </div>
                </button>
              </motion.section>
            </div>
          </motion.div>
        ) : view === "ppt-topic-entry" ? (
          <motion.div
            key="ppt-topic-entry"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-16"
          >
            <button
              onClick={() => setView(selectedApp === 'ieee-maker' ? "dashboard" : "ppt-config")}
              className={`flex items-center gap-2 transition-all mb-8 group ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-zinc-900'}`}
            >
              <div className={`p-1.5 rounded-lg border transition-colors ${isDarkMode ? 'border-zinc-800 group-hover:bg-zinc-800' : 'border-gray-100 group-hover:bg-gray-50'}`}>
                <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              </div>
              <span className="text-sm font-bold tracking-tight uppercase">Configuration</span>
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12">
              <div className="lg:col-span-7 lg:pr-8 space-y-10">
                {/* Configuration Section for IEEE Maker moved here */}
                {selectedApp === 'ieee-maker' && (
                  <div className="p-8 rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/20 mb-8">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-orange-500/10">
                        <Hash className="w-5 h-5 text-orange-500" />
                      </div>
                      <h3 className="font-black text-sm uppercase tracking-widest text-zinc-700">Section Count</h3>
                      <div className="ml-auto w-16 h-12 rounded-xl flex items-center justify-center bg-white shadow-md border-2 border-zinc-900">
                        <span className="text-2xl font-black text-zinc-900 leading-none">{pptConfig.slides}</span>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <input 
                        type="range" 
                        min="1" 
                        max="20" 
                        value={pptConfig.slides}
                        onChange={(e) => setPptConfig(prev => ({ ...prev, slides: parseInt(e.target.value) }))}
                        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-zinc-900 bg-gray-200"
                      />
                      <div className="flex justify-between text-[10px] font-black tracking-widest text-gray-400 uppercase">
                        <span>1 SECTION</span>
                        <span>20 SECTIONS</span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-4 italic">Higher section counts will generate a more comprehensive research manuscript.</p>
                  </div>
                )}

                <header>
                  <div className={`w-14 h-14 mb-6 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-600 text-white shadow-xl shadow-blue-600/20'}`}>
                    <Wand2 className="w-8 h-8" />
                  </div>
                  <h2 className={`text-4xl md:text-5xl font-black mb-4 tracking-tight leading-tight transition-all ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>
                    {selectedApp === 'ieee-maker' ? 'Scientific' : "What's the"} <span className="text-blue-600 italic">{selectedApp === 'ieee-maker' ? 'Manuscript' : 'Mission?'}</span>
                  </h2>
                  <p className={`text-base md:text-lg font-medium leading-relaxed ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
                    {selectedApp === 'ieee-maker' 
                      ? 'Submit your research hypothesis. Our AI will architect a publication-grade outline following IEEE standards.'
                      : 'Define your research topic. Our AI will analyze the conceptual depth and prepare the subtopic architecture.'}
                  </p>
                </header>
                <form onSubmit={handleTopicSubmit} className="space-y-8">
                  <div className="relative group">
                    <textarea
                      value={topic}
                      autoFocus
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="e.g. The impact of blockchain on global supply chains..."
                      className={`relative w-full h-40 md:h-52 p-6 md:p-8 rounded-2xl text-lg md:text-2xl font-bold bg-transparent border-2 outline-none transition-all resize-none shadow-2xl ${isDarkMode ? 'border-zinc-800 text-white placeholder-zinc-700 bg-zinc-900/50 focus:border-zinc-700' : 'border-gray-200 text-zinc-900 placeholder-gray-300 bg-white focus:border-blue-500 shadow-gray-200/50 outline-none'}`}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!topic.trim()}
                    className={`w-full py-5 md:py-6 rounded-2xl font-black text-lg md:text-xl transition-all flex items-center justify-center gap-4 shadow-2xl disabled:opacity-50 hover:scale-[1.01] active:scale-95 ${isDarkMode ? 'bg-white text-black shadow-white/10' : 'bg-zinc-900 text-white shadow-black/20'}`}
                  >
                    <span>ANALYZE TOPIC</span>
                    <ArrowRight className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                </form>
              </div>

              <div className="lg:col-span-5">
                <div className={`p-6 md:p-8 rounded-[2rem] border min-h-full ${isDarkMode ? 'bg-zinc-900/50 border-zinc-800 shadow-inner' : 'bg-white border-gray-100 shadow-xl shadow-gray-200/40'}`}>
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                        <Paperclip className="w-4 h-4" />
                      </div>
                      <h4 className={`text-sm font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-zinc-400' : 'text-zinc-700'}`}>
                        Knowledge Base
                      </h4>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <label className={`group relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-3xl cursor-pointer transition-all ${isDarkMode ? 'border-zinc-800 hover:border-zinc-600 bg-zinc-950/50 hover:bg-zinc-950' : 'border-gray-200 hover:border-blue-400 bg-gray-50/50 hover:bg-blue-50/50 shadow-inner'}`}>
                      <Upload className="w-8 h-8 text-blue-500 mb-2 transition-transform group-hover:-translate-y-1" />
                      <span className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>Import Assets</span>
                      <p className="text-[10px] text-gray-500 mt-2 text-center uppercase tracking-widest leading-relaxed">
                        PDF, Images or References
                      </p>
                      <input type="file" multiple className="hidden" onChange={handleFileSelect} />
                    </label>

                    <div className={`space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar ${isIndexing ? 'opacity-50 grayscale' : ''}`}>
                      {isIndexing && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/5 rounded-2xl backdrop-blur-[1px]">
                           <div className="flex items-center gap-2 bg-white dark:bg-zinc-800 px-4 py-2 rounded-full shadow-lg border border-blue-500/30">
                             <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                             <span className="text-[10px] font-bold text-blue-500 uppercase tracking-tighter">Indexing...</span>
                           </div>
                        </div>
                      )}
                      {uploadedFiles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 opacity-30">
                          <File className="w-6 h-6 mb-2" />
                          <p className="text-[10px] font-black uppercase tracking-widest leading-tight">No files detected</p>
                        </div>
                      ) : (
                        uploadedFiles.map(file => (
                          <div key={file.id} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100 shadow-sm'}`}>
                            <div className="flex items-center gap-3 overflow-hidden">
                              <File className="w-3.5 h-3.5 text-blue-500" />
                              <div className="overflow-hidden">
                                <p className="text-[10px] font-bold truncate dark:text-white leading-tight">{file.name}</p>
                                <p className="text-[8px] text-gray-500 uppercase tracking-tighter">{(file.size / 1024).toFixed(1)} KB</p>
                              </div>
                            </div>
                            <button onClick={() => removeFile(file.id)} className="text-gray-400 hover:text-red-500 transition-colors p-1.5">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
                  {view === "ppt-structure-entry" 
                    ? (selectedApp === 'ieee-maker' ? 'Construct Paper Outline' : 'Generate Structure')
                    : (selectedApp === 'ieee-maker' ? `Drafting Section: ${subtopics[activeSubtopicIndex]}` : `Defining ${subtopics[activeSubtopicIndex]}`)}
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
              <h2 className={`text-7xl md:text-8xl font-display font-bold mb-8 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                {selectedApp === 'ieee-maker' ? 'Review Manuscript Blueprint' : 'Review Final Content'}
              </h2>
              <p className="text-gray-400 text-xl font-light">
                {selectedApp === 'ieee-maker' ? 'The drafted content for your academic paper.' : 'Here is the summarized structure for your presentation.'}
              </p>
            </header>

            <div className="space-y-6 mb-20">
              <div className={`border rounded-[40px] p-10 shadow-sm transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
                <h3 className={`text-4xl md:text-5xl font-display font-bold mb-10 pb-6 border-b ${isDarkMode ? 'text-white border-zinc-800' : 'text-black border-gray-100'}`}>Main Topic: {topic}</h3>
                
                <div className="space-y-12">
                  {slidesData.slice(0, subtopics.length).map((slide, idx) => (
                    <div key={idx} className="flex gap-10">
                      <div className={`text-5xl font-display font-bold mt-[-8px] ${isDarkMode ? 'text-zinc-800' : 'text-gray-100'}`}>0{idx + 1}</div>
                      <div>
                        <h4 className={`text-3xl font-display font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-black'}`}>{slide.title}</h4>
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
                {selectedApp === 'ieee-maker' ? 'Create Final Manuscript' : 'Create Presentation Prompt'}
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
              <h2 className={`text-6xl font-display font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-black'}`}>Your Website Prompt is Ready</h2>
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
            className={`min-h-screen py-8 md:py-12 px-4 transition-colors ${isDarkMode ? 'bg-zinc-950' : 'bg-gray-50'}`}
          >
            <div className="max-w-7xl mx-auto">
              <header className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8 mb-12">
                <div className="flex items-center gap-5">
                  <button
                    onClick={() => setView("dashboard")}
                    className={`p-3 border rounded-2xl transition-all hover:scale-105 active:scale-95 ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-white' : 'bg-white border-gray-100 text-gray-400 hover:text-black shadow-sm'}`}
                  >
                    <ChevronLeft className="w-6 h-6 md:w-8 md:h-8" />
                  </button>
                  <div className="space-y-1">
                    <h2 className={`text-3xl md:text-5xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-zinc-900'}`}>Artifact Synthesis</h2>
                    <p className="text-sm md:text-lg font-medium text-gray-400">Review and finalize your cross-device compatible presentation.</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                  {!generatedCode ? (
                    <div className="flex flex-wrap gap-3 w-full lg:w-auto">
                      <button
                        onClick={() => setIsLiked(!isLiked)}
                        className={`flex-1 lg:flex-none flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${isLiked ? 'bg-pink-500 text-white shadow-xl shadow-pink-500/20' : (isDarkMode ? 'bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-pink-400 hover:border-pink-500/30' : 'bg-white text-gray-400 border border-gray-100 hover:border-pink-200 hover:text-pink-500 shadow-sm')}`}
                      >
                        <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
                        {isLiked ? "Saved" : "Save Logic"}
                      </button>

                      <button
                        onClick={exportToPDF}
                        disabled={isExporting}
                        className={`flex-1 lg:flex-none flex items-center justify-center gap-3 py-4 px-8 rounded-2xl font-black text-xs uppercase tracking-widest transition-all hover:scale-105 active:scale-95 shadow-2xl ${isDarkMode ? 'bg-white text-black shadow-white/10' : 'bg-zinc-900 text-white shadow-black/20'}`}
                      >
                        {isExporting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {isExporting ? "Processing..." : "Download as PDF"}
                      </button>

                      <div className="flex gap-2 w-full sm:w-auto">
                        <button
                          onClick={downloadNotes}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 border py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-blue-400 hover:bg-zinc-800' : 'bg-white text-blue-600 border-blue-50 hover:bg-blue-50/50 shadow-sm'}`}
                        >
                          <FileText className="w-4 h-4" />
                          Notes
                        </button>

                        <button
                          onClick={handleFinalizePPTX}
                          className={`flex-1 sm:flex-none flex items-center justify-center gap-2 border py-4 px-6 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${isDarkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white' : 'bg-white text-gray-400 border border-gray-100 hover:border-gray-200 hover:text-black shadow-sm'}`}
                        >
                          <FileOutput className="w-4 h-4" />
                          PPTX
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={exportToHighFidelityPDF}
                      disabled={isExporting}
                      className={`w-full lg:w-auto flex items-center justify-center gap-3 py-4 md:py-5 px-8 md:px-12 rounded-[2rem] font-black text-sm uppercase tracking-[0.2em] transition-all hover:scale-105 active:scale-95 shadow-2xl disabled:opacity-50 ${isDarkMode ? 'bg-white text-black shadow-white/10' : 'bg-zinc-900 text-white shadow-black/20'}`}
                    >
                      {isExporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                      {isExporting ? "Processing Synthesis..." : "Download as PDF"}
                    </button>
                  )}
                </div>
              </header>

              <div ref={previewRef} className="space-y-12 h-full flex flex-col lg:flex-row gap-6">
                {generatedCode ? (
                  <>
                  <div className="relative flex-1 rounded-[32px] overflow-hidden border border-gray-200 dark:border-zinc-800 bg-white transition-all duration-500 h-[80vh]">
                    <button 
                      onClick={handleOpenNewTab}
                      className="absolute top-6 right-6 z-10 bg-blue-600/90 hover:bg-blue-600 text-white p-3 rounded-2xl shadow-xl transition-all border border-blue-400/20"
                      title="Open in New Tab"
                    >
                      <ExternalLink className="w-5 h-5" />
                    </button>
                    <iframe
                      title="AI Synthesis Preview"
                      srcDoc={injectedCode}
                      className="w-full h-full border-none"
                      sandbox="allow-scripts allow-modals allow-downloads allow-forms"
                    />
                  </div>

                  <div className="w-full lg:w-96 flex flex-col gap-4">
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

            <h2 className={`text-6xl font-display font-bold mb-6 ${isDarkMode ? 'text-white' : 'text-black'}`}>
              {isGenerating ? "Synthesizing..." : (selectedApp === 'ieee-maker' ? "Manuscript Ready!" : "Presentation Ready!")}
            </h2>
            <p className={`text-xl font-light mb-12 max-w-md mx-auto ${isDarkMode ? 'text-zinc-400' : 'text-gray-500'}`}>
              {isGenerating 
                ? (selectedApp === 'ieee-maker' ? "Our AI engine is compiling your manuscript, formatting columns, and generating a scientific PDF." : "Our AI engine is compiling your content, optimizing layouts, and generating a high-fidelity PDF document.")
                : (selectedApp === 'ieee-maker' ? "Your IEEE formatted manuscript has been generated and the download should start automatically." : "Your PDF presentation has been generated and the download should start automatically.")}
            </p>

            <div className="flex flex-col gap-4">
              {!isGenerating && (
                <div className="flex flex-col gap-4 w-full">
                  <button
                    onClick={exportToHighFidelityPDF}
                    disabled={isExporting}
                    className={`py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all hover:scale-[1.02] shadow-xl disabled:opacity-50 ${isDarkMode ? 'bg-white text-black shadow-white/5' : 'bg-black text-white shadow-black/10'}`}
                  >
                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                    {isExporting ? "Processing..." : "Download PDF Again"}
                  </button>
                  <button
                    onClick={downloadNotes}
                    className="bg-blue-600 text-white py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
                  >
                    <FileText className="w-5 h-5" /> {selectedApp === 'ieee-maker' ? 'Download Research Brief' : 'Download Notes (PDF)'}
                  </button>
                  {selectedApp !== 'ieee-maker' && (
                    <button
                      onClick={handleFinalizePPTX}
                      className={`py-5 px-10 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${isDarkMode ? 'bg-zinc-800 border border-zinc-700 text-white hover:bg-zinc-700' : 'bg-gray-100 text-black hover:bg-gray-200'}`}
                    >
                      <FileOutput className="w-5 h-5" /> Export as PPTX instead
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={handleReset}
                className={`font-semibold py-4 transition-colors ${isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-gray-400 hover:text-black'}`}
              >
                {selectedApp === 'ieee-maker' ? 'Draft another manuscript' : 'Create another presentation'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}




