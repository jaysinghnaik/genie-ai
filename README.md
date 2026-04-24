# 🧞‍♂️ Genie-AI — Intelligent Presentation Generation System

Genie-AI is a **serverless AI-powered system** that transforms simple text prompts into fully structured, downloadable PowerPoint presentations.
It is designed as a **cost-efficient, scalable AI application** using a decentralized API model and modern web architecture.

---

## 🧩 Problem

Creating high-quality presentations is time-consuming and repetitive:

* Requires manual research
* Needs logical structuring of ideas
* Formatting slides takes significant effort

Students and professionals often spend **hours converting ideas into slides**.

---

## 💡 Solution

Genie-AI automates the entire pipeline:

**Topic → Structured Outline → Slide Content → Downloadable PPT**

It leverages Large Language Models to generate **coherent, structured, and ready-to-use presentations** in seconds.

---

## 🚀 Key Features

* **AI-Powered Slide Generation**
  Automatically generates structured slide content using Google Gemini.

* **Bring Your Own Key (BYOK)**
  Users provide their own API keys, enabling **zero hosting cost** and scalable usage.

* **Instant PPT Downloads**
  Generates `.pptx` files directly in the browser using high-performance client-side rendering.

* **Secure Authentication**
  Google Sign-In via Firebase for user-specific configuration and history.

* **Responsive UI**
  Optimized for both mobile (e.g., WhatsApp sharing workflows) and desktop environments.

---

## 🧠 AI Pipeline (Core Engineering)

Genie-AI uses a **multi-step generation pipeline** instead of a single prompt:

1. **Input Processing**
   User topic is refined into a structured query.

2. **Outline Generation**
   AI creates a logical slide structure (sections & flow).

3. **Content Generation**
   Each slide is populated with concise bullet points.

4. **Formatting Layer**
   Structured content is converted into PPT format using `pptxgenjs`.

This approach improves:

* Content coherence
* Logical flow
* Slide readability

---

## 🏗️ Architecture Overview

```
User (Browser)
   ↓
Next.js Frontend (UI Layer)
   ↓
Vercel Serverless Functions (API Layer)
   ↓
Google Gemini API (AI Processing)
   ↓
Client-side PPT Generation (pptxgenjs)

+ Firebase:
   - Authentication (User Identity)
   - Firestore (API Key Storage)
```

### Key Design Decisions:

* **Serverless Backend** → No infrastructure management
* **Client-side Rendering** → Faster downloads, reduced backend load
* **BYOK Model** → Eliminates operational API costs

---

## ⚡ Advanced Capabilities

* **Stateless AI execution** for scalability
* **Decentralized API usage (BYOK)**
* **Low-latency PPT generation (<10 seconds)**
* **Edge-optimized architecture (Vercel serverless)**

---

## 🛠️ Tech Stack

* **Frontend:** Next.js (React)
* **Backend:** Vercel Serverless Functions
* **Database:** Firebase Firestore
* **Authentication:** Firebase Auth
* **AI Engine:** Google Gemini API
* **Presentation Engine:** pptxgenjs

---

## 🔒 Security Notes

* API keys are stored in **Firestore with user-scoped access rules**
* Only authenticated users can access their own keys
* Sensitive operations are handled via backend API routes
* No shared API key exposure across users

---


## 📖 How to Use

1. **Sign In**
   Log in using your Google account.

2. **Get API Key**
   Visit Google AI Studio and generate a free API key.

3. **Configure**
   Paste your API key into Genie-AI.

4. **Generate PPT**
   Enter a topic and click **Generate**.

5. **Download**
   Your presentation is ready instantly.

---

## 🛠️ Local Development

```bash
git clone https://github.com/jaysinghnaik/genie-ai.git
cd genie-ai
npm install
npm run dev
```

---

## 🚀 Why Genie-AI?

* Zero-cost hosting model (BYOK)
* Fully serverless and scalable architecture
* Fast, real-time AI generation
* Designed for practical, real-world usage

---

## 📌 Future Improvements

* Retrieval-Augmented Generation (RAG) for document-based PPTs
* Multi-step reasoning with editable slide refinement
* Template customization and design automation
* AI-assisted PPT editing (upload → improve workflow)

---

## 🧾 Summary

Genie-AI is not just a PPT generator—it is a **lightweight AI system** demonstrating:

* Practical LLM integration
* Serverless architecture design
* Cost-efficient AI deployment strategies

It reflects a shift from simple AI usage to **applied AI system engineering**.

---
