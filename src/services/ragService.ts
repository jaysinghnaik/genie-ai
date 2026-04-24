import { GoogleGenAI } from "@google/genai";

export interface Chunk {
  id: string;
  text: string;
}

export interface SlideData {
  title: string;
  points: string[];
}

export interface VerificationResult {
  score: number;
  issues: string[];
}

export class RAGService {
  private ai: any;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * 1. Chunking (still LLM-based but improved prompt)
   */
  async chunkDocument(document: string): Promise<Chunk[]> {
    const prompt = `
Split the document strictly using structural rules.

Rules:
- Split by headings (#, ##, etc.) if present
- Otherwise split by paragraphs
- Each chunk must be 100–250 words
- Do NOT interpret or modify text
- Do NOT merge unrelated sections
- Preserve exact original wording

Return ONLY valid JSON:
[
  { "id": "chunk_1", "text": "..." }
]

Document:
${document}
`;
    const result = await this.generate(prompt);
    return this.parseJSON(result);
  }

  /**
   * 2. Faster Retrieval (single efficient call)
   */
  async retrieveRelevantChunks(chunks: Chunk[], query: string): Promise<Chunk[]> {
    const prompt = `
Select the most relevant chunks for the topic "${query}".

Rules:
- Prioritize chunks with direct keyword or semantic relevance
- Select only top 3–4 chunks (strict limit)
- Avoid repetition
- Prefer chunks with clear, factual content
- Ignore vague or generic text

Return ONLY valid JSON:
[
  { "id": "...", "text": "..." }
]

Chunks:
${JSON.stringify(chunks, null, 2)}
`;
    const result = await this.generate(prompt);
    return this.parseJSON(result);
  }

  /**
   * 3. Token Reduction (important optimization)
   */
  async reduceTokens(relevantChunks: Chunk[]): Promise<string> {
    const prompt = `
Reduce the following chunks while preserving meaning.

Rules:
- Remove redundant sentences
- Keep key facts only
- Do NOT lose important details
- Keep it concise

Return plain text.

Chunks:
${relevantChunks.map(c => c.text).join("\n\n---\n\n")}
`;
    return await this.generate(prompt);
  }

  /**
   * 4. Direct Slide Generation (skip extra processing)
   */
  async generateSlide(subtopic: string, context: string): Promise<SlideData> {
    const prompt = `
Create a presentation slide for "${subtopic}" using ONLY the provided context.

Rules:
- Extract directly from chunks (no separate summarization step)
- 4–5 bullet points only
- Each point must clearly map to chunk content
- No external knowledge
- Keep language short and precise

Return ONLY valid JSON:
{
  "title": "...",
  "points": ["...", "..."]
}

Context:
${context}
`;
    const result = await this.generate(prompt);
    return this.parseJSON(result);
  }

  /**
   * 5. Ultra-light Verification (faster)
   */
  async verifySlideDetailed(
    slide: SlideData,
    context: string
  ): Promise<VerificationResult> {
    const prompt = `
Evaluate the slide based on provided chunks.

Rules:
- Check if each point is supported
- Be strict but concise
- Give a score (1–10)
- List only critical issues (max 3)

Return ONLY valid JSON:
{
  "score": 0-10,
  "issues": ["..."]
}

Chunks:
${context}

Slide:
${JSON.stringify(slide, null, 2)}
`;
    const result = await this.generate(prompt);
    return this.parseJSON(result);
  }

  /**
   * 6. Fast Regeneration (only when needed)
   */
  async regenerateSlideSmart(
    subtopic: string,
    context: string,
    issues: string[]
  ): Promise<SlideData> {
    const prompt = `
Fix the slide using the issues.

Rules:
- Only fix incorrect points
- Keep correct points unchanged
- Use ONLY given chunks
- Maintain 4–5 bullet points

Return ONLY valid JSON:
{
  "title": "...",
  "points": ["...", "..."]
}

Chunks:
${context}

Issues:
${JSON.stringify(issues)}
`;
    const result = await this.generate(prompt);
    return this.parseJSON(result);
  }

  /**
   * Helper: unified LLM call
   */
  private async generate(prompt: string): Promise<string> {
    const res = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return res.text;
  }

  /**
   * Robust JSON parser
   */
  private parseJSON(text: string): any {
    try {
      const codeBlockMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
      }

      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      const firstBracket = text.indexOf("[");
      const lastBracket = text.lastIndexOf("]");

      if (firstBracket !== -1 && lastBracket !== -1) {
        return JSON.parse(text.substring(firstBracket, lastBracket + 1));
      }

      if (firstBrace !== -1 && lastBrace !== -1) {
        return JSON.parse(text.substring(firstBrace, lastBrace + 1));
      }

      return JSON.parse(text.trim());
    } catch (e) {
      console.error("JSON parse failed:", text);
      return [];
    }
  }
}