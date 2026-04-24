
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
  suggestions: string[];
}

export class RAGService {
  private ai: any;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  /**
   * 1. Deterministic Chunking
   */
  async chunkDocument(document: string): Promise<Chunk[]> {
    const prompt = `
Split the document into chunks using structure, not interpretation.

Rules:
- Split by headings if present
- Otherwise split by paragraphs
- Each chunk must be 100–300 words
- Do NOT merge unrelated sections
- Preserve original wording exactly

Return output ONLY as a JSON array. Do not include talk, reasoning, or preamble.
[
  { "id": "chunk_1", "text": "..." }
]

Document:
${document}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return this.parseJSON(result.text);
  }

  /**
   * 2. Pre-filter Retrieval (reduce AI load)
   */
  private async preFilterRetrieval(chunks: Chunk[], query: string): Promise<Chunk[]> {
    const prompt = `
From the given chunks, first filter only those that contain keywords or closely related terms to the topic "${query}".

Rules:
- Keep only chunks that directly mention or strongly relate to the topic
- Remove unrelated or weakly related chunks
- Do not exceed 8 chunks
- Preserve original text exactly

Return output ONLY as a JSON array.
[
  { "id": "...", "text": "..." }
]

Chunks:
${JSON.stringify(chunks, null, 2)}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return this.parseJSON(result.text);
  }

  /**
   * 2.1 Refined Hybrid Retrieval (after pre-filter)
   */
  async retrieveRelevantChunks(chunks: Chunk[], query: string): Promise<Chunk[]> {
    const filteredChunks = await this.preFilterRetrieval(chunks, query);
    
    const prompt = `
From the filtered chunks, select the most useful ones for creating a presentation slide on "${query}".

Rules:
- Select top 3–5 chunks
- Prioritize clarity, completeness, and relevance
- Avoid repetition
- Ignore vague content

Return output ONLY as a JSON array.
[
  { "id": "...", "text": "..." }
]

Filtered Chunks:
${JSON.stringify(filteredChunks, null, 2)}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return this.parseJSON(result.text);
  }

  /**
   * 2.2 Consistent Context Generation
   */
  async generateContextString(relevantChunks: Chunk[]): Promise<string> {
    const prompt = `
Combine the selected chunks into a clean context for slide generation.

Rules:
- Do not summarize aggressively
- Keep key details
- Remove redundancy
- Maintain factual accuracy

Return as plain text.

Chunks:
${relevantChunks.map(c => c.text).join("\n\n---\n\n")}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return result.text.trim();
  }

  /**
   * 3. Improved Slide Generation (stable output)
   */
  async generateSlide(subtopic: string, context: string): Promise<SlideData> {
    const prompt = `
Create a presentation slide for "${subtopic}" using ONLY the provided context.

Rules:
- 4–6 bullet points only
- Each point must be supported by context
- Keep language simple and clear
- No external knowledge
- Avoid repetition

Return output ONLY as a JSON object.
{
  "title": "...",
  "points": ["...", "..."]
}

Context:
${context}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return this.parseJSON(result.text);
  }

  /**
   * 4. Stronger Verification (replace old logic)
   */
  async verifySlideDetailed(slide: SlideData, context: string): Promise<VerificationResult> {
    const prompt = `
Evaluate the slide using the provided context.

Rules:
- Check if each point is supported by context
- Identify unsupported or hallucinated content
- Score from 1 to 10 based on grounding and clarity

Return output ONLY as a JSON object.
{
  "score": 0-10,
  "issues": ["..."],
  "suggestions": ["..."]
}

Context:
${context}

Slide:
${JSON.stringify(slide, null, 2)}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return this.parseJSON(result.text);
  }

  /**
   * 5. Simplified Regeneration Condition Prompt
   */
  async regenerateSlideSmart(subtopic: string, context: string, issues: string[], suggestions: string[]): Promise<SlideData> {
    const prompt = `
Improve the slide based on the issues and suggestions.

Rules:
- Fix only the problematic parts
- Use ONLY the provided context
- Keep 4–6 bullet points
- Maintain clarity and accuracy

Return output ONLY as a JSON object.
{
  "title": "...",
  "points": ["...", "..."]
}

Context:
${context}

Issues:
${JSON.stringify(issues)}

Suggestions:
${JSON.stringify(suggestions)}
`;
    const result = await this.ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return this.parseJSON(result.text);
  }

  private parseJSON(text: string): any {
    try {
      // Try to extract JSON from code blocks first
      const codeBlockMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        return JSON.parse(codeBlockMatch[1]);
      }

      // If no code block, look for array or object structures more precisely
      // We look for the first [ or { and the corresponding last patch
      const arrayStart = text.indexOf('[');
      const arrayEnd = text.lastIndexOf(']');
      const objectStart = text.indexOf('{');
      const objectEnd = text.lastIndexOf('}');

      if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
        if (arrayEnd !== -1 && arrayEnd > arrayStart) {
          return JSON.parse(text.substring(arrayStart, arrayEnd + 1));
        }
      } else if (objectStart !== -1) {
        if (objectEnd !== -1 && objectEnd > objectStart) {
          return JSON.parse(text.substring(objectStart, objectEnd + 1));
        }
      }

      // Last ditch effort: direct parse
      return JSON.parse(text.trim());
    } catch (e) {
      console.error("Failed to parse JSON from AI response:", text, e);
      return [];
    }
  }
}
