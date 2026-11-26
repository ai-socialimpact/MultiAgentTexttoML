import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_DEFAULT_API_KEY });
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_DEFAULT_API_KEY || '',
  dangerouslyAllowBrowser: true 
});
const getAnthropicClient = () => {
  return new Anthropic({
    apiKey: process.env.CLAUDE_DEFAULT_API_KEY || process.env.ANTHROPIC_API_KEY || '',
    dangerouslyAllowBrowser: true 
  });
};

const MODELS = [
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
  'claude-opus-5-5',
  'gpt-6.1-sol',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gpt4o',
  'gpt-5.4',
  'gpt-5.4-2026-03-05',
  'gpt-5.4-mini'
];

let modelIndex = 0;

async function callWithRetry(
  agentName: string,
  prompt: string,
  fn: (model: string) => Promise<any>,
  preferredModel?: string,
  onLog?: (log: { agent: string, prompt: string, response?: string, error?: string, modelUsed?: string }) => void
) {
  // If preferred model is set, try it first, then rotate if it fails
  const startModelIndex = preferredModel ? MODELS.indexOf(preferredModel) : modelIndex;
  
  for (let i = 0; i < MODELS.length * 2; i++) {
    const modelIndexToUse = (startModelIndex + i) % MODELS.length;
    const model = MODELS[modelIndexToUse] || MODELS[0];
    
    try {
      let result;
      if (model.startsWith('claude')) {
        const anthropic = getAnthropicClient();
        const stream = anthropic.messages.stream({
          model: model, // claude-opus-5-5
          max_tokens: 30096,
          messages: [{ role: 'user', content: prompt }],
        });
        result = await stream.finalText();
        if (prompt.includes('JSON') && typeof result === 'string') {
          try {
            const jsonText = result.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
            result = JSON.parse(jsonText);
          } catch (e) {
            try {
              result = JSON.parse(result);
            } catch {}
          }
        }
      } else if (model.startsWith('gpt')) {
        const response = await openai.chat.completions.create({
          model: model === 'gpt4o' ? 'gpt-4o' : model,
          messages: [{ role: 'user', content: prompt }],
          response_format: prompt.includes('JSON') ? { type: 'json_object' } : undefined
        });
        result = response.choices[0].message.content;
        if (prompt.includes('JSON') && typeof result === 'string') {
          try {
            result = JSON.parse(result);
          } catch (e) {}
        }
      } else {
        result = await fn(model);
      }
      
      if (onLog) onLog({ agent: agentName, prompt, response: typeof result === 'string' ? result : JSON.stringify(result), modelUsed: model });
      return { data: result, modelUsed: model };
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      const isRetryableError = 
        errorMsg.includes('429') || 
        errorMsg.includes('RESOURCE_EXHAUSTED') || 
        errorMsg.includes('insufficient_quota') ||
        errorMsg.includes('overloaded') ||
        errorMsg.includes('Streaming is strongly recommended') ||
        errorMsg.includes('rate_limit');
      
      if (onLog) onLog({ agent: agentName, prompt, error: errorMsg, modelUsed: model });

      if (isRetryableError) {
        console.warn(`Retryable error on ${model} (${errorMsg}), rotating model...`);
        continue;
      }
      throw error;
    }
  }
  throw new Error("All models exhausted or failed.");
}

export const agents = {
  // Query Interpreter
  interpretQuery: async (query: string, schema: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Query Interpreter agent.
      Given the user query: "${query}"
      And the database schema: "${schema}"
      
      Refine the query to map to the schema columns. Identify the correct table names and column names based on the schema.
      Return ONLY a JSON object with:
      {
        "classification": "Data Analysis" | "Machine Learning" | "Visualization",
        "refinedQuery": "The refined query string",
        "identifiedTables": ["table1", "table2"],
        "identifiedColumns": ["col1", "col2"]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Query Interpreter', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      return JSON.parse(response.text || '{}');
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  // Query Interpreter with Schema, Few-Shot Description, and Few-Shot Examples (HITL)
  refineUserQueryWithContext: async (
    query: string,
    context: {
      schemaDescription?: string;
      fewShotDescription?: string;
      fewShotExamples?: string;
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Query Interpreter agent.
      Given the user query: "${query}"
      
      === SCHEMA DESCRIPTION (schemadescription.txt - DDL & Domain Paragraphs) ===
      ${context.schemaDescription || 'No explicit schema provided. Infer from general data science standards.'}
      
      === FEW-SHOT DESCRIPTION (few_shot_description.txt) ===
      ${context.fewShotDescription || 'None provided.'}
      
      === FEW-SHOT EXAMPLES (Few_shot_examples.json) ===
      ${context.fewShotExamples || 'None provided.'}
      
      Task:
      Refine the user query to be precise, domain-aligned, unambiguous, and mathematically well-defined.
      Use the table definitions, field names, domain rules from schemadescription.txt, and patterns from few-shot guidelines and examples.
      
      Return ONLY a JSON object:
      {
        "refinedQuery": "Refined and unambiguous query mapped to schema and business logic",
        "reasoning": "Clear explanation of how the schema and few-shot context helped clarify the user query",
        "identifiedTables": ["table1", "table2"],
        "identifiedColumns": ["column1", "column2"],
        "domainAssumptions": [
          "Assumption or filter applied based on domain rules"
        ]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Query Interpreter - HITL Refinement', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  // Planner Agent
  planAnalysis: async (refinedQuery: string, schema: string, template: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Analysis Planner agent.
      Refined Query: "${refinedQuery}"
      Schema: "${schema}"
      AI Processing Template: "${template}"
      
      Create a step-by-step plan to analyze the data and answer the query based on the chosen template.
      Break it down into:
      1. Data Ingestion & Inspection (Check columns and types)
      2. Data Cleaning (Handle missing values, type conversion)
      3. Transformation (Filtering, Grouping, Aggregation)
      4. Final Analysis/Visualization (Calculate results)
      
      Return ONLY a JSON object with:
      {
        "steps": ["Step 1 description", "Step 2 description", ...]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Planner Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"steps": []}');
      } catch (e) {
        return { steps: [] };
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  refinePlan: async (plan: string[], userGuidance: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Analysis Planner agent.
      Current Plan:
      ${plan.map((step, i) => `${i + 1}. ${step}`).join('\n')}
      
      User Guidance for Refinement: "${userGuidance}"
      
      Refine the step-by-step plan based on the user's guidance.
      
      Return ONLY a JSON object with:
      {
        "steps": ["Step 1 description", "Step 2 description", ...]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Planner Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"steps": []}');
      } catch (e) {
        return { steps: [] };
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  explainQuery: async (refinedQuery: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Explainer agent.
      Refined Query: "${refinedQuery}"
      
      Provide a simple, easy-to-understand English explanation of what this query is trying to achieve.
      Keep it concise (1-2 sentences).
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Explainer Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return response.text || '';
    }, preferredModel, onLog);
    
    return { text: result, modelUsed };
  },

  generateSuggestions: async (taskType: string, schema: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Auto-Generate Suggestions agent.
      Task Type: "${taskType}"
      Schema: "${schema}"
      
      Generate 3 to 5 suggested queries based on the task type and the provided schema.
      Make them realistic and useful for data analysis.
      
      Examples of good suggestions based on task types:
      - Text to Data insights: "What is the average revenue by region?"
      - Text to ML insights: "Predict the likelihood of churn based on usage."
      - Text to Visuals: "Show a bar chart of sales over time."
      
      Return ONLY a JSON object with:
      {
        "suggestions": ["suggestion 1", "suggestion 2", ...]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Auto-Generate Suggestions', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"suggestions": []}');
      } catch (e) {
        return { suggestions: [] };
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  // Question Variation Generator Agent
  generateEditableFields: async (code: string, refinedQuery: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Question Variation Generator Agent.
      
      Successfully Executed Code:
      \`\`\`javascript
      ${code}
      \`\`\`
      
      Refined Query: "${refinedQuery}"
      
      Identify the key parameters, filters, column names, or specific values in the query and code that a user might want to change to run the analysis on different data or with different constraints.
      
      Return ONLY a JSON object with an array of editable fields:
      {
        "fields": [
          { "name": "Region", "currentValue": "North America", "description": "The region to filter by" },
          { "name": "Metric", "currentValue": "Revenue", "description": "The column to aggregate" }
        ]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Question Variation Generator Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"fields": []}');
      } catch (e) {
        return { fields: [] };
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  generateSimilarQuestions: async (userQuery: string, refinedQuery: string, code: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Question Variation Generator Agent.
      
      Original User Query: "${userQuery}"
      Refined Query: "${refinedQuery}"
      Successfully Executed Code:
      \`\`\`javascript
      ${code}
      \`\`\`
      
      Generate 3 similar question variations that explore the data in a slightly different way (e.g., grouping by a different dimension, using a different aggregation, or changing a filter condition).
      
      Return ONLY a JSON object with:
      {
        "variations": ["Variation 1", "Variation 2", "Variation 3"]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Question Variation Generator Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"variations": []}');
      } catch (e) {
        return { variations: [] };
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  // Strategy Creator Agent
  suggestStrategyQuestions: async (schema: string, dataSubset: any, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Strategy Creator Agent.
      
      Schema: "${schema}"
      Data Subset: ${JSON.stringify(dataSubset)}
      
      Suggest 3 high-level strategy questions that require a multi-step analysis (answering 2-3 sub-queries together).
      These questions should be complex and provide strategic business or data insights.
      
      Return ONLY a JSON object with:
      {
        "strategies": [
          {
            "question": "Strategy Question 1",
            "subQueries": ["Sub-query 1", "Sub-query 2"]
          },
          ...
        ]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Strategy Creator Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"strategies": []}');
      } catch (e) {
        return { strategies: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);
    
    return { ...result, modelUsed };
  },

  recommendStrategiesFromFavourites: async (favourites: any[], schema: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Strategy Creator Agent.
      
      Schema: "${schema}"
      Saved Favourites (Queries and Results): ${JSON.stringify(favourites)}
      
      Based on the user's favourite queries and their results, recommend 3 advanced strategy questions.
      Each strategy should synthesize information that would require 2-3 specific sub-queries to be answered.
      
      Return ONLY a JSON object with:
      {
        "strategies": [
          {
            "question": "Recommended Strategy Question 1",
            "subQueries": ["Sub-query 1", "Sub-query 2", "Sub-query 3"]
          },
          ...
        ]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Strategy Creator Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"strategies": []}');
      } catch (e) {
        return { strategies: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);
    
    return { ...result, modelUsed };
  },

  analyzeStrategy: async (strategyQuestion: string, subQueryResults: any[], preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Strategy Creator Agent.
      
      Strategy Question: "${strategyQuestion}"
      Sub-Query Results: ${JSON.stringify(subQueryResults)}
      
      Analyze the overall strategy by synthesizing the results from the sub-queries.
      Provide a comprehensive strategic answer to the main question.
      
      Return ONLY a JSON object with:
      {
        "analysis": "Detailed strategic analysis and answer"
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Strategy Creator Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"analysis": ""}');
      } catch (e) {
        return { analysis: "" };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);
    
    return { ...result, modelUsed };
  },

  generateInsightsFromFavourites: async (favourites: any[], schema: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Insights Generator Agent.
      
      Schema: "${schema}"
      Saved Favourites (Queries, Plans, and Narratives): ${JSON.stringify(favourites)}
      
      Analyze the provided favourites and combine their findings to derive a high-level insight, hypothesis, or strategy.
      
      Return ONLY a JSON object with:
      {
        "insight": "The derived insight or strategy",
        "reasoningSteps": ["Step 1", "Step 2", ...],
        "sourceFavourites": [
          {
            "id": "ID of the favourite used",
            "refinedQuery": "Refined Query of the favourite",
            "analysisPlan": "Analysis Plan of the favourite",
            "narrative": "AI Narrative of the favourite"
          }
        ]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Insights Generator Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"insight": "", "reasoningSteps": [], "sourceFavourites": []}');
      } catch (e) {
        return { insight: "", reasoningSteps: [], sourceFavourites: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);
    
    return { ...result, modelUsed };
  },

  similaritySearch: async (query: string, favourites: any[], preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Similarity Search Agent.
      
      Search Query: "${query}"
      Favourites List: ${JSON.stringify(favourites.map(f => ({ id: f.id, userQuery: f.userQuery, refinedQuery: f.refinedQuery })))}
      
      Find the top 3 most similar queries from the Favourites list based on the search query.
      The similarity can be based on the intent, the data fields involved, or the type of analysis.
      
      Return ONLY a JSON object with:
      {
        "matches": [
          {
            "id": "ID of the matching favourite",
            "score": 0.95 // Confidence score
          }
        ]
      }
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Similarity Search Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"matches": []}');
      } catch (e) {
        return { matches: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);
    
    return { ...result, modelUsed };
  },

  explainFindings: async (findings: any[], preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Explainer agent.
      Here are the successful findings from the analysis iterations:
      ${JSON.stringify(findings)}
      
      Synthesize these findings into a comprehensive, professional, neatly formatted report.
      Use Markdown formatting (headings, bullet points, bold text) to make it easy to read.
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Explainer Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return response.text || '';
    }, preferredModel, onLog);
    
    return { text: result, modelUsed };
  },

  // Code Generator
  generateCode: async (refinedQuery: string, schema: string, plan: string[], errorTelemetry?: string, previousCode?: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Code Generator agent.
      Write JavaScript code using Danfo.js (available as 'dfd') and TensorFlow.js (available as 'tf') to answer the query: "${refinedQuery}"
      Schema: "${schema}"
      
      Plan to follow:
      ${plan.map((step, i) => `${i + 1}. ${step}`).join('\n')}
      
      ${errorTelemetry ? `Previous error or feedback: ${errorTelemetry}.\nPrevious code:\n${previousCode}\n\nAnalyze why the code failed or what needs to be changed based on the feedback, reason what to change, and generate the fixed code.` : ''}
      
      The input data is ALREADY LOADED and available as the global variable 'data' (an object where keys are filenames and values are arrays of JSON objects).
      DO NOT attempt to load the CSV files using dfd.readCSV() or fetch(). You MUST use the 'data' variable directly.
      
      Output Requirements:
      - Return ONLY a JSON object with two keys:
        - "reasoning": A string explaining your thought process, why the previous code failed (if applicable), and what you are doing in this code.
        - "code": The raw JavaScript code to execute.
      - If the query implies a visualization (e.g., "distribution", "trend", "compare"), return an object with a 'chartSpec' property from your JavaScript code.
        Example: return { chartSpec: { type: 'bar', data: { labels: [...], datasets: [{ label: 'Dataset 1', data: [...] }] } } };
      - If the query implies a summary or single value, return an object with a 'summary' key or other descriptive keys from your JavaScript code.
      - Ensure the code handles potential missing values or incorrect data types gracefully.
      - Use async/await if needed.
      
      DEBUGGING REQUIREMENTS:
      - Use console.log() to print out each major step of the analysis based on the plan.
      - Before processing, log the filenames found in the dataset using Object.keys(data).
      - For each file, log the columns found using Object.keys(data[filename][0]).
      - If required columns are missing, log exactly which columns were expected vs found.
      
      Example for Visualization code string:
      console.log("Step 1: Ingesting data...");
      const filename = Object.keys(data)[0];
      const df = new dfd.DataFrame(data[filename]);
      console.log("Columns found in " + filename + ":", df.columns);
      // ... cleaning and transformation ...
      console.log("Step 4: Calculating results...");
      return { chartSpec: { type: 'bar', data: { labels: [...], datasets: [{ label: 'Data', data: [...] }] } } };
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Code Generator', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      
      try {
        const parsed = JSON.parse(response.text || '{}');
        return {
          reasoning: parsed.reasoning || 'No reasoning provided.',
          code: parsed.code || ''
        };
      } catch (e) {
        return {
          reasoning: 'Failed to parse JSON response.',
          code: response.text || ''
        };
      }
    }, preferredModel, onLog);
    
    return { ...result, modelUsed };
  },

  // Result Evaluator (Reasoning Agent 1)
  evaluateResult: async (query: string, result: any, code: string, preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Result Evaluator agent.
      User query: "${query}"
      Code executed:
      ${code}
      
      Execution result:
      ${JSON.stringify(result)}
      
      Analyze if the execution result successfully answers the user's query.
      If it does, set "isComplete" to true.
      If it does not (e.g. missing data, wrong format, empty arrays when data was expected), set "isComplete" to false and provide "suggestedNextSteps" for the Code Generator to fix the logic.
      
      Return ONLY a JSON object with:
      {
        "reasoning": "Your thought process evaluating the result",
        "isComplete": boolean,
        "suggestedNextSteps": "Tips for the code generator if not complete, or null if complete"
      }
    `;
    
    const { data: evalResult, modelUsed } = await callWithRetry('Result Evaluator', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      return JSON.parse(response.text || '{}');
    }, preferredModel, onLog);
    
    return { ...evalResult, modelUsed };
  },

  // Error Analyzer (Reasoning Agent 2)
  analyzeError: async (query: string, error: string, code: string, logs: string[], preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Error Analyzer agent.
      User query: "${query}"
      Code that failed:
      ${code}
      
      Execution Logs:
      ${logs.join('\n')}
      
      Error Message:
      ${error}
      
      Analyze why the code failed. Provide specific, actionable tips for the Code Generator to fix the issue.
      
      Return ONLY a JSON object with:
      {
        "reasoning": "Your thought process analyzing the error",
        "tips": "Specific instructions for the code generator to fix the code"
      }
    `;
    
    const { data: analysisResult, modelUsed } = await callWithRetry('Error Analyzer', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      return JSON.parse(response.text || '{}');
    }, preferredModel, onLog);
    
    return { ...analysisResult, modelUsed };
  },

  // Explainer
  explainResults: async (query: string, results: any, preferredModel?: string, onLog?: any, targetAudienceInstruction?: string) => {
    const prompt = `
      You are the Explainer agent.
      User query: "${query}"
      Analysis results: ${JSON.stringify(results)}
      
      ${targetAudienceInstruction ? `TARGET AUDIENCE INSTRUCTION:\n${targetAudienceInstruction}\n` : ''}
      
      Synthesize these results into a clear, descriptive narrative reasoning for the user.
      Keep it concise (1-2 paragraphs), tailored to the specified audience understanding level.
    `;
    
    const { data: result, modelUsed } = await callWithRetry('Explainer Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      
      return response.text || '';
    }, preferredModel, onLog);
    
    return { text: result, modelUsed };
  },

  // Comparison Explainer for Favourites (New Result vs Previous Result with Persona)
  explainComparisonResults: async (
    params: {
      query: string;
      newResult: any;
      previousResult?: any;
      targetAudienceInstruction?: string;
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const safeNew = (() => {
      try {
        const s = typeof params.newResult === 'string' ? params.newResult : JSON.stringify(params.newResult, null, 2);
        return (s || '').slice(0, 12000);
      } catch {
        return String(params.newResult).slice(0, 12000);
      }
    })();

    const hasPrevious = params.previousResult !== undefined && params.previousResult !== null;
    const safePrev = hasPrevious
      ? (() => {
          try {
            const s = typeof params.previousResult === 'string' ? params.previousResult : JSON.stringify(params.previousResult, null, 2);
            return (s || '').slice(0, 8000);
          } catch {
            return String(params.previousResult).slice(0, 8000);
          }
        })()
      : '';

    const prompt = `
      You are the Explainer agent helping a user understand data analysis results.
      User Query: "${params.query}"

      ${params.targetAudienceInstruction ? `TARGET AUDIENCE PERSONA:\n${params.targetAudienceInstruction}\n` : ''}

      NEW RESULT (Latest Run):
      ${safeNew}

      ${hasPrevious ? `PREVIOUS SAVED RESULT (Baseline Run):\n${safePrev}\n` : ''}

      Instructions:
      - Adapt vocabulary, tone, and analogies strictly to the Target Audience Persona above.
      ${hasPrevious
        ? `- Start with a clear summary of the New Result, then highlight the key differences and numerical shifts compared to the Previous Saved Result (what went up, down, or stayed consistent, and what that means practically).`
        : `- Explain what the result means clearly and highlight key numbers, patterns, and practical takeaways.`}
      - Use clean, scannable formatting with short paragraphs or concise bullet points. Avoid raw JSON brackets in your explanation.
    `;

    const { data: result, modelUsed } = await callWithRetry('Comparison Explainer Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt
      });
      return response.text || '';
    }, preferredModel, onLog);

    return { text: result, modelUsed };
  },

  // Answer Consistency Planning Agent
  planConsistencyRuns: async (
    query: string, 
    schema: string, 
    preferredModel?: string, 
    onLog?: any,
    userGuidance?: string,
    planningPromptInstructions?: string
  ) => {
    const hasGuidance = Boolean(userGuidance && userGuidance.trim());
    const effectiveInstructions = planningPromptInstructions && planningPromptInstructions.trim()
      ? planningPromptInstructions.trim()
      : `Your objective is to test the consistency and stability of the answer across 5 independent analytical runs.
Propose exactly 5 distinct, rigorous data science / statistical methods to answer the question from different analytical perspectives.

Examples of data science methods:
1. Direct Mean / Sum Aggregation (standard parametric baseline)
2. Median & Non-Parametric Distribution (robust to outliers and skewed distributions)
3. Weighted Ratio / Volume-Weighted Calculation (accounts for varying sub-sample sizes)
4. Outlier-Filtered / Trimmed Mean (removes top/bottom 5% extreme data points)
5. Cumulative Frequency & Rank-Order Distribution (evaluates dominance by relative rank share)
6. Z-Score Normalized Comparative Analysis (standardizes variances across dimensions)`;

    const prompt = `
      You are the Answer Consistency Planning Agent.
      User Question: "${query}"
      Database Schema: "${schema}"
      ${hasGuidance ? `
      USER GUIDANCE & METHOD SUGGESTIONS:
      """
      ${userGuidance?.trim()}
      """
      CRITICAL INSTRUCTION: The user has provided specific suggestions and guidance for the data science / ML methods they desire. You MUST incorporate the user's requested methods, statistical techniques, or analytical preferences into the 5 formulated runs. Formulate 5 complementary, rigorous methods that align directly with the user's guidance while ensuring each run provides a distinct, valid, and complementary perspective to test answer consistency.
      ` : ''}
      
      PLANNING INSTRUCTIONS & METHOD FORMULATION GUIDELINES:
      """
      ${effectiveInstructions}
      """
      
      For each run, craft:
      - methodName: Clear, professional data science or ML method title
      - methodCategory: e.g. "Parametric Aggregation", "Deep Neural Network (TensorFlow.js)", "Regularized ML", "Robust Non-Parametric", "Weighted Estimation", "Rank-Order Distribution"
      - rationale: Why this specific technique provides an independent validation test${hasGuidance ? ' (note how it incorporates user guidance)' : ''}
      - modifiedQuery: The original question augmented with instructions detailing the data science or ML method (e.g. data preprocessing, algorithms, TensorFlow.js layers, or statistical procedures) so the Query Interpreter and Code Generator execute it accurately.
      
      Return ONLY a JSON object:
      {
        "methodologyOverview": "Brief summary of how these 5 data science / ML methods evaluate answer consistency${hasGuidance ? ', highlighting how user suggestions were incorporated' : ''}",
        "runs": [
          {
            "runNumber": 1,
            "methodName": "Direct Sum & Mean Aggregation",
            "methodCategory": "Parametric Aggregation",
            "rationale": "Establishes baseline unweighted parametric metric across all records.",
            "modifiedQuery": "..."
          },
          {
            "runNumber": 2,
            "methodName": "Median & Robust IQR Distribution",
            "methodCategory": "Robust Non-Parametric",
            "rationale": "Protects against skewed tails and extreme values by computing medians.",
            "modifiedQuery": "..."
          },
          {
            "runNumber": 3,
            "methodName": "Weighted Ratio & Volume-Weighted Average",
            "methodCategory": "Weighted Estimation",
            "rationale": "Weights data points proportionally to transaction/volume magnitude.",
            "modifiedQuery": "..."
          },
          {
            "runNumber": 4,
            "methodName": "Outlier-Trimmed Filtered Metric",
            "methodCategory": "Outlier-Filtered",
            "rationale": "Trims the top and bottom 5% extremes before computing aggregates.",
            "modifiedQuery": "..."
          },
          {
            "runNumber": 5,
            "methodName": "Rank-Order & Cumulative Share Analysis",
            "methodCategory": "Rank-Order Distribution",
            "rationale": "Validates if the leader holds dominant ranking across subgroups.",
            "modifiedQuery": "..."
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Answer Consistency Planner', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"runs": []}');
      } catch (e) {
        return { runs: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // Answer Consistency Evaluation Agent
  analyzeAnswerConsistency: async (originalQuestion: string, runsData: any[], preferredModel?: string, onLog?: any) => {
    const prompt = `
      You are the Answer Consistency Evaluation Agent.
      Original User Question: "${originalQuestion}"
      
      Here are the results of 5 independent runs executed using different data science methods:
      ${JSON.stringify(runsData.map(r => ({
        runNumber: r.runNumber,
        methodName: r.methodName,
        modifiedQuery: r.modifiedQuery,
        refinedQuery: r.refinedQuery,
        resultSummary: r.result,
        narrative: r.narrative
      })))}
      
      RULE ON AGREEMENT LEVEL:
      - If 4 or 5 runs yield the same answer/conclusion: agreementLevel is "Exceptional" (agreement score >= 80%).
      - If 3 runs agree: agreementLevel is "High" (60%).
      - If 2 runs agree: agreementLevel is "Moderate" (40%).
      - If 1 or 0 runs agree: agreementLevel is "Low / Inconclusive" (<= 20%).
      
      Analyze whether the 5 data science methods converge on the same answer:
      1. Extract the specific conclusion / answer found by each run.
      2. Identify the consensus (dominant) answer.
      3. Count how many runs strictly agree with the consensus answer.
      4. Note any interesting nuances (e.g. median vs mean differences, outlier impact).
      5. Provide an executive summary and final verdict.
      
      Return ONLY a JSON object:
      {
        "consensusAnswer": "Specific primary answer found (e.g. Category X with $120k revenue)",
        "agreementLevel": "Exceptional" | "High" | "Moderate" | "Low",
        "agreeingRunsCount": number (e.g. 5 or 4),
        "totalRunsCount": 5,
        "agreementScore": number (percentage e.g. 100 or 80),
        "isExceptional": boolean (true if agreeingRunsCount >= 4),
        "runEvaluations": [
          {
            "runNumber": 1,
            "methodName": "string",
            "extractedAnswer": "Specific key finding / answer value from this run",
            "isAlignedWithConsensus": boolean,
            "methodNuance": "Brief sentence explaining alignment or variance"
          }
        ],
        "consistencyVerdict": "Clear executive verdict explaining the level of agreement across methods",
        "detailedSynthesis": "In-depth explanation of how different statistical treatments behaved and why the result is robust",
        "keyTakeaway": "Actionable takeaway based on the validated answer"
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Answer Consistency Evaluator', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // Explainer Agent: Answer questions about Consistency Dossier
  answerConsistencyQuestion: async (
    userQuestion: string,
    reportContext: {
      originalQuery: string;
      consensusAnswer: string;
      consistencyVerdict: string;
      detailedSynthesis: string;
      runs: any[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Explainer Agent answering a question about an Answer Consistency Dossier.
      Original Analyzed Query: "${reportContext.originalQuery}"
      Consensus Answer: "${reportContext.consensusAnswer}"
      Verdict: "${reportContext.consistencyVerdict}"
      Detailed Synthesis: "${reportContext.detailedSynthesis}"
      
      5 Runs Data & Data Science Methods:
      ${JSON.stringify(reportContext.runs.map(r => ({
        runNumber: r.runNumber,
        methodName: r.methodName,
        methodCategory: r.methodCategory,
        rationale: r.rationale,
        modifiedQuery: r.modifiedQuery,
        refinedQuery: r.refinedQuery,
        resultSummary: r.extractedAnswer || r.result,
        narrative: r.narrative,
        isAligned: r.isAlignedWithConsensus
      })))}
      
      User's Question about this Dossier:
      "${userQuestion}"
      
      Provide a comprehensive, accurate, professional, and clear answer.
      Address the specific data science methods, statistical nuances, or business implications requested.
      Format with clean Markdown.
    `;

    const { data: result, modelUsed } = await callWithRetry('Explainer Agent - Q&A', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return response.text || '';
    }, preferredModel, onLog);

    return { answer: result, modelUsed };
  },

  // Explainer Agent: Refine Report based on user suggestion
  refineConsistencyReport: async (
    suggestion: string,
    reportContext: {
      originalQuery: string;
      consensusAnswer: string;
      consistencyVerdict: string;
      detailedSynthesis: string;
      keyTakeaway?: string;
      runs: any[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Explainer Agent refining an Answer Consistency Dossier based on user suggestions.
      User's Suggestion: "${suggestion}"
      
      Current Report State:
      - Original Query: "${reportContext.originalQuery}"
      - Consensus Answer: "${reportContext.consensusAnswer}"
      - Current Verdict: "${reportContext.consistencyVerdict}"
      - Current Detailed Synthesis: "${reportContext.detailedSynthesis}"
      - Current Key Takeaway: "${reportContext.keyTakeaway || ''}"
      
      5 Runs Data:
      ${JSON.stringify(reportContext.runs.map(r => ({
        runNumber: r.runNumber,
        methodName: r.methodName,
        methodCategory: r.methodCategory,
        resultSummary: r.extractedAnswer,
        isAligned: r.isAlignedWithConsensus
      })))}
      
      Rewrite and refine the report elements strictly incorporating the user's specific suggestions while keeping factual consistency with the 5 data science runs.
      
      Return ONLY a JSON object:
      {
        "consensusAnswer": "Refined or preserved consensus answer",
        "consistencyVerdict": "Refined executive verdict incorporating user suggestions",
        "detailedSynthesis": "Refined detailed scientific synthesis incorporating user suggestions",
        "keyTakeaway": "Refined key business takeaway incorporating user suggestions",
        "laymanExplanation": "A freshly refined lay-man friendly summary matching user focus"
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Explainer Agent - Refine Report', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // Explainer Agent: Tailor Consistency Dossier for a specific audience persona (NGO Intern, NGO Volunteer, NGO Program Leader, Data Scientist)
  tailorConsistencyDossierForPersona: async (
    persona: {
      id: string;
      label: string;
      instructionPrompt: string;
    },
    reportContext: {
      originalQuery: string;
      consensusAnswer: string;
      consistencyVerdict: string;
      detailedSynthesis: string;
      keyTakeaway?: string;
      runs: any[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Explainer Agent tailoring an Answer Consistency Dossier for a specific audience persona.
      SELECTED AUDIENCE PERSONA: "${persona.label}"
      AUDIENCE INSTRUCTIONS:
      ${persona.instructionPrompt}

      Current Dossier Context:
      - Original Query: "${reportContext.originalQuery}"
      - Consensus Answer: "${reportContext.consensusAnswer}"
      - Current Verdict: "${reportContext.consistencyVerdict}"
      - Current Detailed Synthesis: "${reportContext.detailedSynthesis}"
      - Current Key Takeaway: "${reportContext.keyTakeaway || ''}"

      5 Runs Empirical Evidence (MUST remain 100% factually faithful to these numbers):
      ${JSON.stringify(reportContext.runs.map(r => ({
        runNumber: r.runNumber,
        methodName: r.methodName,
        methodCategory: r.methodCategory,
        resultSummary: r.extractedAnswer,
        isAligned: r.isAlignedWithConsensus
      })))}

      Rewrite the dossier fields strictly tailored to the "${persona.label}" persona while preserving all numerical accuracy.
      Return ONLY a JSON object:
      {
        "consensusAnswer": "Factually accurate consensus answer written clearly for this persona",
        "consistencyVerdict": "Executive verdict framed specifically for this persona",
        "detailedSynthesis": "Detailed synthesis explaining how the 5 checks converged, tailored to this persona's background and priorities",
        "keyTakeaway": "Actionable key takeaway framed specifically for this persona",
        "laymanExplanation": "Ultra-clear, encouraging plain-language summary matching this persona"
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Explainer Agent - Tailor Dossier Persona', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // Explainer Agent: Generate Custom Visuals for Dossier
  generateConsistencyVisuals: async (
    userPrompt: string,
    reportContext: {
      originalQuery: string;
      consensusAnswer: string;
      runs: any[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Explainer Agent generating visual charts for an Answer Consistency Report.
      User visual preference or prompt: "${userPrompt || 'Suggest and create an insightful visual chart comparing the 5 data science methods'}"
      
      Original Query: "${reportContext.originalQuery}"
      Consensus Answer: "${reportContext.consensusAnswer}"
      5 Runs Data:
      ${JSON.stringify(reportContext.runs.map(r => ({
        runNumber: r.runNumber,
        methodName: r.methodName,
        methodCategory: r.methodCategory,
        result: r.result,
        extractedAnswer: r.extractedAnswer,
        isAlignedWithConsensus: r.isAlignedWithConsensus
      })))}
      
      Create 1 or 2 new intuitive visual charts.
      Each chart must have:
      1. id: unique string e.g. "chart-1"
      2. title: Descriptive, professional chart title
      3. type: "bar" | "donut" | "radar" | "progress" | "comparison"
      4. description: Short explanation of what this chart illustrates
      5. items: Array of data items to plot, each with:
         - label: string (e.g. Method name, group, or run number)
         - value: number (percentage 0-100 or metric value)
         - displayValue: string (formatted label e.g. "$45.2k", "100%", "Rank 1")
         - status: "aligned" | "nuance" | "neutral"
         - note: optional brief note
      
      Return ONLY a JSON object:
      {
        "visuals": [
          {
            "id": "visual-1",
            "title": "Method Reliability & Alignment Score",
            "type": "bar",
            "description": "Comparative distribution across the 5 analytical techniques",
            "items": [
              { "label": "Run 1: Mean Aggregation", "value": 100, "displayValue": "100% Match", "status": "aligned", "note": "Parametric baseline" },
              { "label": "Run 2: Median Distribution", "value": 100, "displayValue": "100% Match", "status": "aligned", "note": "Robust to extremes" },
              { "label": "Run 3: Ratio of Sums", "value": 100, "displayValue": "100% Match", "status": "aligned", "note": "Volume weighted" },
              { "label": "Run 4: Outlier-Trimmed", "value": 90, "displayValue": "Minor Variance", "status": "nuance", "note": "5% extreme truncation" },
              { "label": "Run 5: Rank-Order Share", "value": 100, "displayValue": "100% Match", "status": "aligned", "note": "Ordinal dominance" }
            ]
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Explainer Agent - Visuals Generator', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        const parsed = JSON.parse(response.text || '{"visuals": []}');
        const visuals = Array.isArray(parsed.visuals) ? parsed.visuals.map((v: any, idx: number) => ({
          ...v,
          id: `vis-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 9)}`
        })) : [];
        return { visuals };
      } catch (e) {
        return { visuals: [] };
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // Explainer Agent: Contextualize Consistency Dossier using uploaded schemadescription.txt
  contextualizeConsistencyReport: async (
    schemaDescription: string,
    reportContext: {
      originalQuery: string;
      consensusAnswer: string;
      consistencyVerdict: string;
      detailedSynthesis: string;
      runs: any[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Explainer Agent and a Senior Domain Architect & Database Specialist.
      You are tasked with providing a deep, domain-specific contextualization of an Answer Consistency Dossier using the uploaded 'schemadescription.txt' from Project Files.
      
      === UPLOADED SCHEMA DESCRIPTION (DDL & DOMAIN PARAGRAPHS) ===
      ${schemaDescription || 'No explicit DDL provided. Derive contextualization from data structure.'}
      
      === USER QUESTION & ANSWER CONSISTENCY DOSSIER ===
      User Question: "${reportContext.originalQuery}"
      Consensus Answer: "${reportContext.consensusAnswer}"
      Verdict: "${reportContext.consistencyVerdict}"
      Detailed Synthesis: "${reportContext.detailedSynthesis}"
      
      5 Runs Data & Methods:
      ${JSON.stringify(reportContext.runs.map(r => ({
        runNumber: r.runNumber,
        methodName: r.methodName,
        methodCategory: r.methodCategory,
        rationale: r.rationale,
        modifiedQuery: r.modifiedQuery,
        refinedQuery: r.refinedQuery,
        resultSummary: r.extractedAnswer || r.result,
        narrative: r.narrative,
        isAligned: r.isAlignedWithConsensus
      })))}
      
      === OBJECTIVE ===
      Explain the answers from the 5 runs in the exact context of the database schema DDL, entity relationships, business definitions, and domain paragraphs in schemadescription.txt.
      Make it seamless and authoritative for a domain expert to understand how the statistical results map to domain entities, business logic, constraints, and why different methods yielded their specific answers.
      
      Return ONLY a JSON object:
      {
        "domainOverview": "A high-level domain explanation connecting the question and consensus answer to business reality and schema entities.",
        "schemaEntities": [
          {
            "tableName": "Entity or table name from DDL",
            "role": "How this table/concept operates in the context of the user question",
            "relevantColumns": ["column1", "column2"]
          }
        ],
        "contextualizedRuns": [
          {
            "runNumber": 1,
            "methodName": "Method name",
            "domainInterpretation": "Domain explanation of why this calculation/aggregation behaved this way based on schema structure, business rules, and real-world domain dynamics."
          }
        ],
        "domainNuancesAndCaveats": "Critical domain-specific caveats, business constraints, or data lineage observations identified from the schema description.",
        "domainExpertRecommendations": [
          "Domain recommendation 1",
          "Domain recommendation 2"
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Explainer Agent - Contextualizer', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // Strategic Meta-Planner Agent: Break down complex Strategy or Text-to-ML queries into 5 progressive sub-questions
  planStrategicSubQuestions: async (
    query: string,
    schema: string,
    metaPlannerPrompt?: string,
    userGuidance?: string,
    preferredModel?: string,
    onLog?: any
  ) => {
    const hasGuidance = Boolean(userGuidance && userGuidance.trim());
    const effectivePrompt = metaPlannerPrompt && metaPlannerPrompt.trim()
      ? metaPlannerPrompt.trim()
      : `You are a Principal Data Scientist and Strategic Meta-Planner.
Break down complex strategic business problems and Text-to-ML tasks into an interconnected sequence of exactly 5 progressive empirical sub-questions / experiments.
Each sub-question must build sequentially upon the findings, datasets, and features discovered in previous steps.

For Text-to-ML modeling questions, plan 5 experiments covering:
1. ML dataset scoping, baseline distribution & target definition
2. Feature engineering, extraction & correlation analysis
3. Dataset size, class balance, train/test splitting & baseline benchmark
4. Model architecture selection, training & parameter tuning (e.g. TensorFlow.js / Danfo.js)
5. Model evaluation, inference, decision thresholds & strategic translation

For Strategic Business questions, plan 5 experiments covering:
1. Baseline diagnosis, volume sizing & KPI current-state audit
2. Driver attribution & root-cause cohort decomposition
3. Opportunity sizing, elasticity & segment prioritization
4. Scenario simulation, sensitivity modeling & trade-off analysis
5. Strategic recommendations, operational targets & rollout matrix`;

    const prompt = `
      You are the Meta-Planner Agent for Strategic Multi-Step Data Science & ML.
      Strategic User Question: "${query}"
      Database Schema Context: "${schema}"
      ${hasGuidance ? `
      OPTIONAL USER GUIDANCE & METHOD SUGGESTIONS:
      """
      ${userGuidance?.trim()}
      """
      Incorporate user suggestions into the planned sub-tasks.
      ` : ''}

      META-PLANNER INSTRUCTIONS:
      """
      ${effectivePrompt}
      """

      Formulate exactly 5 progressive, interconnected sub-questions.
      Return ONLY a JSON object:
      {
        "metaPlanOverview": "Executive summary of the 5-step experimentation roadmap and how they build on each other",
        "questionType": "Text-to-ML" | "Strategic Analysis" | "Multi-Step Discovery",
        "subQuestions": [
          {
            "stepNumber": 1,
            "title": "Short descriptive step title (e.g. Dataset Scope & Target Formulation)",
            "subQuestion": "Precise empirical question to test and answer",
            "objective": "What hypothesis is tested or what empirical foundation is established",
            "plannedMethod": "Data science or ML technique (e.g. Column profiling, correlation matrix, TF.js classification)",
            "expectedOutput": "Key metric, model artifact, or table to produce"
          },
          {
            "stepNumber": 2,
            "title": "Short descriptive step title",
            "subQuestion": "Precise empirical question to test and answer",
            "objective": "What hypothesis is tested",
            "plannedMethod": "Data science or ML technique",
            "expectedOutput": "Key output"
          },
          {
            "stepNumber": 3,
            "title": "Short descriptive step title",
            "subQuestion": "Precise empirical question to test and answer",
            "objective": "What hypothesis is tested",
            "plannedMethod": "Data science or ML technique",
            "expectedOutput": "Key output"
          },
          {
            "stepNumber": 4,
            "title": "Short descriptive step title",
            "subQuestion": "Precise empirical question to test and answer",
            "objective": "What hypothesis is tested",
            "plannedMethod": "Data science or ML technique",
            "expectedOutput": "Key output"
          },
          {
            "stepNumber": 5,
            "title": "Short descriptive step title",
            "subQuestion": "Precise empirical question to test and answer",
            "objective": "What hypothesis is tested",
            "plannedMethod": "Data science or ML technique",
            "expectedOutput": "Key output"
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Strategic Meta-Planner', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"subQuestions": []}');
      } catch (e) {
        return { subQuestions: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // Strategic Steering Agent: Prompt multi-choice forward paths after completing each sub-question
  generateForwardPathChoices: async (
    currentStep: {
      stepNumber: number;
      title: string;
      subQuestion: string;
      resultSummary: string;
      extractedMetrics?: any;
    },
    nextStep: {
      stepNumber: number;
      title: string;
      subQuestion: string;
      plannedMethod: string;
    } | null,
    cumulativeContext: string,
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Strategic Steering Agent.
      A user has just completed Step ${currentStep.stepNumber}: "${currentStep.title}".
      Empirical findings from this step:
      "${currentStep.resultSummary}"
      
      Cumulative context from previous steps:
      "${cumulativeContext}"
      
      ${nextStep ? `Upcoming planned Step ${nextStep.stepNumber}: "${nextStep.title}" with planned question: "${nextStep.subQuestion}".` : 'This was the final step of the multi-step pipeline.'}
      
      Formulate 3 to 4 distinct forward-path choices for the user to steer the next step or strategic interpretation.
      The first choice should be the optimal recommended path.
      Choices must be practical, specific data science / ML decisions (e.g. feature retention, threshold tuning, outlier treatment, segment focus).
      
      Return ONLY a JSON object:
      {
        "stepSynthesis": "1-2 sentence core finding of Step ${currentStep.stepNumber}",
        "choices": [
          {
            "id": "choice-1",
            "label": "Brief label (under 10 words)",
            "description": "Clear explanation of this direction and its rationale",
            "isRecommended": true,
            "adjustedNextSubQuestion": "Updated or refined prompt for next step if this choice is selected",
            "simplifiedExplanation": {
              "simpleTitle": "Friendly title in plain words (e.g. Follow the Winning Clue)",
              "simpleAnalogy": "Fun everyday analogy (e.g. Like keeping the best spice that made the dish delicious)",
              "whatHappensNext": "In the next step, we will test whether this pattern stays true across all groups.",
              "bestFor": "Pick this if you want the most reliable, direct answer."
            }
          },
          {
            "id": "choice-2",
            "label": "Brief label (under 10 words)",
            "description": "Clear explanation of this direction and its rationale",
            "isRecommended": false,
            "adjustedNextSubQuestion": "Updated or refined prompt for next step if this choice is selected",
            "simplifiedExplanation": {
              "simpleTitle": "Friendly title in plain words",
              "simpleAnalogy": "Fun everyday analogy",
              "whatHappensNext": "In the next step, we will...",
              "bestFor": "Pick this if..."
            }
          },
          {
            "id": "choice-3",
            "label": "Brief label (under 10 words)",
            "description": "Clear explanation of this direction and its rationale",
            "isRecommended": false,
            "adjustedNextSubQuestion": "Updated or refined prompt for next step if this choice is selected",
            "simplifiedExplanation": {
              "simpleTitle": "Friendly title in plain words",
              "simpleAnalogy": "Fun everyday analogy",
              "whatHappensNext": "In the next step, we will...",
              "bestFor": "Pick this if..."
            }
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Strategic Forward Path Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"choices": []}');
      } catch (e) {
        return { choices: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // Layman Simplification Agent: Explains forward-path choices in simple intuitive everyday language with relatable analogies
  simplifyChoicesForLayman: async (
    stepNumber: number,
    stepTitle: string,
    empiricalFinding: string,
    choices: Array<{ id: string; label: string; description: string; isRecommended?: boolean }>,
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Plain-Language Layman Guide and Intuitive Explainer.
      In a data science experiment pipeline, Step ${stepNumber} ("${stepTitle}") just finished with this finding:
      "${empiricalFinding}"
      
      The user is now at the Interactive Forward-Path Choice Gate. The current choices are technical:
      ${JSON.stringify(choices, null, 2)}
      
      TASK:
      Explain each of these choices in a SIMPLE, INTUITIVE, EASY-TO-UNDERSTAND WAY for a complete layman or school student volunteer!
      Use fun, relatable everyday analogies (like cooking in the kitchen, packing for a vacation, sports tactics, or game decisions).
      Avoid all technical jargon. Tell the user clearly:
      1. What does this choice mean in plain words?
      2. A fun, relatable everyday analogy.
      3. What will happen next if they click this choice.
      4. Who should choose this.
      
      Return ONLY a JSON object:
      {
        "laymanOverview": "1-2 friendly, encouraging sentences explaining what this decision point is about in everyday English.",
        "simplifiedChoices": [
          {
            "id": "choice-1",
            "simpleTitle": "Friendly plain title (e.g. Double down on the winning clue)",
            "simpleAnalogy": "Everyday analogy (e.g. Like keeping the secret spice that made the stew taste great)",
            "whatHappensNext": "In the next step, we will build on this clue directly.",
            "bestFor": "Pick this if you want the safest, most direct path forward."
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Layman Simplifier Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // Dynamic Refinement Agent: Re-plans the next sub-question (and optionally remaining steps) based on the user's forward-path choice and empirical findings
  replanStrategicSubQuestion: async (
    originalStrategicQuestion: string,
    schema: string,
    completedStepsHistory: Array<{
      stepNumber: number;
      title: string;
      subQuestion: string;
      resultSummary: string;
      selectedChoiceLabel?: string;
      userCustomDirection?: string;
    }>,
    nextStepToReplan: {
      stepNumber: number;
      title: string;
      subQuestion: string;
      objective: string;
      plannedMethod: string;
      expectedOutput: string;
    },
    futureSteps: Array<{
      stepNumber: number;
      title: string;
      subQuestion: string;
      objective: string;
      plannedMethod: string;
      expectedOutput: string;
    }>,
    steeringDecision: {
      choiceLabel: string;
      choiceDescription?: string;
      customGuidance?: string;
    },
    replanScope: 'next_only' | 'all_remaining' = 'next_only',
    refinementInstructions?: string,
    preferredModel?: string,
    onLog?: any
  ) => {
    const hasInstructions = Boolean(refinementInstructions && refinementInstructions.trim());
    const prompt = `
      You are the Principal Data Science Strategist and Dynamic Re-Planning Agent.
      
      High-Level Strategic Goal / Question:
      "${originalStrategicQuestion}"
      
      Database Schema:
      "${schema}"
      
      COMPLETED EMPIRICAL STEPS & FINDINGS SO FAR:
      ${JSON.stringify(completedStepsHistory, null, 2)}
      
      HUMAN-IN-THE-LOOP FORWARD-PATH STEERING DECISION:
      - Selected Trajectory: "${steeringDecision.choiceLabel}"
      - Trajectory Details: "${steeringDecision.choiceDescription || 'User-selected direction'}"
      ${steeringDecision.customGuidance ? `- Bespoke User Guidance: "${steeringDecision.customGuidance}"` : ''}
      
      CURRENTLY PLANNED NEXT STEP (Step ${nextStepToReplan.stepNumber}):
      - Title: "${nextStepToReplan.title}"
      - Sub-Question: "${nextStepToReplan.subQuestion}"
      - Objective: "${nextStepToReplan.objective}"
      - Planned Method: "${nextStepToReplan.plannedMethod}"
      - Expected Output: "${nextStepToReplan.expectedOutput}"

      ${replanScope === 'all_remaining' && futureSteps.length > 0 ? `
      SUBSEQUENT FUTURE STEPS (Steps ${futureSteps.map(s => s.stepNumber).join(', ')}):
      ${JSON.stringify(futureSteps, null, 2)}
      ` : ''}

      ${hasInstructions ? `
      USER RE-PLANNING INSTRUCTIONS:
      """
      ${refinementInstructions?.trim()}
      """
      ` : ''}

      TASK:
      Dynamically RE-PLAN Step ${nextStepToReplan.stepNumber} (and ${replanScope === 'all_remaining' ? 'all subsequent remaining steps' : 'only this step'}) based on the empirical results discovered so far and the human steering choice.
      The re-planned sub-question must:
      1. Directly incorporate the chosen steering pivot (e.g. adjust features, cohort filters, model complexity, hyperparameter boundaries, or business logic).
      2. Build directly on the empirical findings discovered in Step ${completedStepsHistory[completedStepsHistory.length - 1]?.stepNumber || 1}.
      3. Be highly actionable, empirical, and executable in a JavaScript / Danfo.js / TensorFlow.js sandbox.
      
      Return ONLY a JSON object:
      {
        "refinementRationale": "2-3 sentences explaining why and how Step ${nextStepToReplan.stepNumber} was dynamically re-planned based on the latest findings and steering choice.",
        "replannedNextStep": {
          "stepNumber": ${nextStepToReplan.stepNumber},
          "title": "Refined and sharpened step title",
          "subQuestion": "Precise, dynamically re-planned empirical sub-question",
          "objective": "Updated objective reflecting the chosen trajectory",
          "plannedMethod": "Adapted data science / ML technique (e.g. TF.js Sequential with dropout, class-weighted cross-entropy, cohort filtering)",
          "expectedOutput": "Specific metrics or tabular outputs expected"
        }${replanScope === 'all_remaining' && futureSteps.length > 0 ? `,
        "replannedFutureSteps": [
          ${futureSteps.map(f => `{
            "stepNumber": ${f.stepNumber},
            "title": "Refined title for Step ${f.stepNumber}",
            "subQuestion": "Refined sub-question for Step ${f.stepNumber}",
            "objective": "Refined objective",
            "plannedMethod": "Refined method",
            "expectedOutput": "Refined output"
          }`).join(',\n')}
        ]` : ''}
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Dynamic Re-Planning Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // Strategic Master Dossier Synthesizer
  synthesizeStrategicDossier: async (
    originalQuestion: string,
    schema: string,
    completedSteps: any[],
    preferredModel?: string,
    onLog?: any,
    targetAudienceInstruction?: string,
    availableColumns?: string[]
  ) => {
    const prompt = `
      You are the Principal Strategic Intelligence Agent.
      Original High-Level Question: "${originalQuestion}"
      Database Schema: "${schema}"
      ${availableColumns && availableColumns.length > 0 ? `Available Exact Dataset Column Names: ${JSON.stringify(availableColumns)}` : ''}

      ${targetAudienceInstruction ? `TARGET AUDIENCE REQUIREMENT:\n${targetAudienceInstruction}\n` : ''}

      5 Completed Progressive Experiments & Decisions:
      ${JSON.stringify(completedSteps.map(s => ({
        stepNumber: s.stepNumber,
        title: s.title,
        subQuestion: s.subQuestion,
        plannedMethod: s.plannedMethod,
        resultSummary: s.resultSummary,
        userDecisionTaken: s.selectedChoiceLabel,
        keyMetrics: s.metrics
      })))}
      
      Synthesize all steps into a definitive, authoritative Strategic Master Dossier tailored to the target audience.
      Provide:
      1. Executive Summary & Core Strategic Answer (tailored for the audience)
      2. Step-by-Step Progressive Evidence Matrix
      3. Actionable Strategic Recommendations:
         CRITICAL REQUIREMENT FOR RECOMMENDATIONS:
         For each recommendation, provide:
         - An easy-to-understand version (plain language, crystal clear explanation)
         - Clear technical info and methodology
         - Concrete, specific dataset column names (e.g. from the dataset columns provided: ${availableColumns && availableColumns.length > 0 ? availableColumns.slice(0, 15).join(', ') : 'target and feature columns'})
         - A complete, copy-pasteable question prompt that the user can cut and paste directly into future questions!
      4. Risks, Limitations & Sensitivity Considerations
      5. Implementation Roadmap
      
      Return ONLY a JSON object:
      {
        "executiveSummary": "Compelling 2-3 paragraph executive summary answering the high-level question tailored to the target audience",
        "strategicVerdict": "Direct 1-2 sentence core verdict tailored to the target audience",
        "confidenceScore": 92,
        "progressiveEvidence": [
          {
            "stepNumber": 1,
            "stepTitle": "Step Title",
            "keyFinding": "Empirical result in audience-friendly language",
            "strategicImpact": "How this impacted subsequent experiments"
          }
        ],
        "strategicRecommendations": [
          "Recommendation summary 1",
          "Recommendation summary 2",
          "Recommendation summary 3"
        ],
        "richRecommendations": [
          {
            "id": "rec-1",
            "title": "Clear action title",
            "easyVersion": "Easy-to-understand plain language version explaining what this means and what to do next",
            "technicalInfo": "Clear technical info, statistical methodology, model tuning or filtering specifics",
            "columnNames": ["column_1", "column_2"],
            "copyPasteableQuestion": "Specific prompt ready to cut and paste into future questions using exact column names"
          }
        ],
        "risksAndCaveats": "Important constraints, data assumptions, or model edge-cases",
        "implementationRoadmap": [
          "Phase 1: Immediate execution",
          "Phase 2: Scaling and monitoring"
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Strategic Dossier Synthesizer', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{}');
      } catch (e) {
        return {};
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  },

  // 1. Strategic Explainer: Help Me Understand specific questions
  answerStrategicQuestion: async (
    userQuestion: string,
    context: {
      strategicQuestion: string;
      audience: string;
      steps: any[];
      dossier: any;
      schema?: string;
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Strategic Explainer Agent answering a question about a completed Strategic Master Dossier.
      Strategic Goal / Question: "${context.strategicQuestion}"
      Target Audience Comprehension Level: "${context.audience}"
      
      Strategic Dossier Findings:
      - Strategic Verdict: "${context.dossier?.strategicVerdict || ''}"
      - Confidence Score: ${context.dossier?.confidenceScore || 90}%
      - Executive Summary: "${context.dossier?.executiveSummary || ''}"
      - Risks & Caveats: "${context.dossier?.risksAndCaveats || ''}"
      
      Completed Progressive Steps Timeline:
      ${JSON.stringify(context.steps.map(s => ({
        stepNumber: s.stepNumber,
        title: s.title,
        subQuestion: s.subQuestion,
        plannedMethod: s.plannedMethod,
        narrative: s.narrative,
        selectedChoice: s.selectedChoiceLabel,
        isReplanned: s.isReplanned
      })))}
      
      User's Specific Question to "Help Me Understand":
      "${userQuestion}"
      
      Provide a comprehensive, crystal-clear explanation tailored specifically to the ${context.audience} level.
      - If technical, explain the statistical mechanisms, data columns, and calculations.
      - If executive/layman, explain the business consequences, intuitive analogies, and actionable takeaways.
      - Include markdown tables or bulleted breakdowns where helpful.
    `;

    const { data: result, modelUsed } = await callWithRetry('Strategic Explainer - Help Me Understand', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      return response.text || '';
    }, preferredModel, onLog);

    return { answer: result, modelUsed };
  },

  // 2. Strategic Framing Agent: How to frame my next question about
  frameNextStrategicQuestion: async (
    userTopic: string,
    context: {
      strategicQuestion: string;
      audience: string;
      steps: any[];
      dossier: any;
      schema?: string;
      availableColumns: string[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Strategic Prompt Engineering & Query Formulation Agent.
      The user completed a 5-step strategic analysis on: "${context.strategicQuestion}"
      Audience: "${context.audience}"
      
      Key Empirical Findings so far:
      ${context.dossier?.strategicVerdict || 'Completed 5-step analysis'}
      
      Available Dataset Columns:
      ${context.availableColumns.slice(0, 50).join(', ')}
      
      Database Schema:
      ${context.schema || 'Standard dataset'}
      
      User's Request: "How to frame my next question about: ${userTopic || 'following up on the primary finding'}"
      
      Formulate 2 to 3 distinct, high-impact, copy-pasteable queries that the user can run in "Answer Strategically" or "Answer Consistency" or SQL sandbox.
      Each framed question MUST:
      1. Reference specific column names from the available dataset.
      2. State the analytical or ML method to employ (e.g., Logistic Regression, Outlier-Trimmed Mean, Cohort Retention Analysis).
      3. State the expected business discovery.
      
      Return ONLY a JSON object:
      {
        "overview": "Brief explanation of how to explore ${userTopic} effectively given the dataset columns",
        "framedQuestions": [
          {
            "prompt": "Exact copy-pasteable query string",
            "title": "Clear objective title",
            "methodology": "Data science / ML method recommended",
            "columns": ["col1", "col2"],
            "businessValue": "What leadership will learn from this analysis"
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Strategic Framing Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"overview": "", "framedQuestions": []}');
      } catch (e) {
        return { overview: '', framedQuestions: [] };
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // 3. Dataset Column Intelligence: Give me specific info column names
  getSpecificColumnInfo: async (
    query: string,
    context: {
      schema: string;
      availableColumns: string[];
      strategicQuestion: string;
      findings?: string;
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Dataset Column Intelligence Agent.
      Available Columns in Dataset:
      ${context.availableColumns.join(', ')}
      
      Database Schema Context:
      ${context.schema}
      
      Strategic Context:
      Question: "${context.strategicQuestion}"
      Findings: "${context.findings || ''}"
      
      User's Column Inquiry: "${query || 'Provide specific info and column recommendations for further testing'}"
      
      Audit the columns and return the top 4 to 8 most relevant columns for this inquiry, their inferred or known data types, business definition, sample values/domains, and how to use them in subsequent queries.
      
      Return ONLY a JSON object:
      {
        "summary": "Brief summary of the column ecosystem related to the user's inquiry",
        "columnsInfo": [
          {
            "name": "column_name",
            "type": "Numeric / Categorical / DateTime / Text / Boolean",
            "description": "Clear business definition of what this column represents",
            "relevance": "Why this column is critical for this analysis or future questions",
            "sampleValues": "e.g. ['Active', 'Churned'] or '0 to 1,500' or '2024-01-01 to 2024-12-31'",
            "recommendedTechniques": "e.g. Group By aggregation, Pearson correlation, Decision Tree feature"
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Column Intelligence Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        return JSON.parse(response.text || '{"summary": "", "columnsInfo": []}');
      } catch (e) {
        return { summary: '', columnsInfo: [] };
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // 4. Strategic Visuals Generator: Add visuals (Supports Bar, Donut, Trend, and KPI Scorecards)
  generateStrategicVisuals: async (
    userPrompt: string,
    context: {
      strategicQuestion: string;
      audience: string;
      steps: any[];
      dossier: any;
      availableColumns: string[];
      preferredType?: 'bar' | 'donut' | 'trend' | 'kpi' | 'auto';
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const prompt = `
      You are the Strategic Visual Intelligence Agent.
      The user has completed a 5-step strategic roadmap on: "${context.strategicQuestion}"
      Strategic Verdict: "${context.dossier?.strategicVerdict || ''}"
      Confidence: ${context.dossier?.confidenceScore || 90}%
      
      Completed Steps Data & Empirical Findings:
      ${JSON.stringify(context.steps.map(s => ({
        stepNumber: s.stepNumber,
        title: s.title,
        method: s.plannedMethod,
        narrative: s.narrative,
        choiceMade: s.selectedChoiceLabel
      })))}
      
      User's Request to "Add Visuals":
      "${userPrompt || 'Create impactful visual charts summarizing the strategic findings and step metrics'}"
      Preferred Visual Type (if indicated): "${context.preferredType || 'auto'}"

      Design 1 or 2 distinct, executive-grade visual charts based on the empirical results.
      
      SUPPORTED CHART TYPES ("chartType"):
      1. "bar": Comparative bar chart. Best for comparing metric values, step performances, category scores, or retention rates.
         - items: 3 to 6 items with "label", "value" (numeric 0-100 or metric value), "formattedValue" (e.g. "84%", "$1.2M"), "color", "sublabel".
      2. "donut": Proportional distribution or factor contribution donut chart. Best for category share, factor importance weights, or churn breakdown.
         - items: 3 to 5 items whose "value" represents percentage share (they should sum close to 100). "label", "value", "formattedValue" (e.g. "38%"), "color", "sublabel".
      3. "trend": Progressive trajectory or multi-step progression line chart. Best for showing metric progression across Step 1 to Step 5, timeline milestones, or threshold convergence.
         - items: 3 to 5 sequential points (e.g. "Step 1", "Step 2", "Step 3"...) with numeric "value", "formattedValue", "color", "sublabel".
      4. "kpi": Multi-metric executive scorecard grid. Best for highlighting 3-4 top-level quantitative takeaways (e.g. Confidence Score, Primary Metric, Stability Index, Risk Factor).
         - items: 3 to 4 metrics with "label", "value" (numeric), "formattedValue" (e.g. "94%", "+18.2%"), "color", "sublabel" (e.g. "Benchmark beat").

      CRITICAL DIVERSITY INSTRUCTION:
      - If 2 charts are generated and no specific single type was locked, provide 2 DIFFERENT chart types (for example, one "bar" and one "donut", or one "trend" and one "donut", or one "bar" and one "kpi").
      - Use professional, distinct hex colors for items (e.g. #2563eb, #10b981, #f59e0b, #8b5cf6, #06b6d4, #ec4899).
      
      Return ONLY a JSON object:
      {
        "visuals": [
          {
            "id": "strat-vis-1",
            "title": "Descriptive Chart Title",
            "chartType": "bar" | "donut" | "trend" | "kpi",
            "description": "What this chart visualizes and context",
            "takeaway": "Key strategic takeaway for leadership",
            "items": [
              {
                "label": "Metric or Step Name",
                "value": 85,
                "formattedValue": "85%",
                "color": "#10b981",
                "sublabel": "Optimal baseline"
              }
            ]
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Strategic Visuals Generator', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        const parsed = JSON.parse(response.text || '{"visuals": []}');
        const visuals = Array.isArray(parsed.visuals) ? parsed.visuals.map((v: any, idx: number) => ({
          ...v,
          chartType: (['bar', 'donut', 'trend', 'kpi'].includes(v.chartType?.toLowerCase())) ? v.chartType.toLowerCase() : 'bar',
          id: `strat-vis-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`
        })) : [];
        return { visuals };
      } catch (e) {
        return { visuals: [] };
      }
    }, preferredModel, onLog);

    return { ...result, modelUsed };
  },

  // 5. Question Genie: Propose interesting, dataset-grounded questions tailored to exploration mode & audience
  proposeStrategicQuestions: async (
    context: {
      mode: 'custom' | 'ml' | 'strategy';
      modeLabel: string;
      schema: string;
      availableColumns: string[];
      sampleRows?: Record<string, any>[];
      audience: string;
      previousQuestions?: string[];
    },
    preferredModel?: string,
    onLog?: any
  ) => {
    const modeObjective =
      context.mode === 'ml'
        ? 'Prediction & Classification (Text-to-ML): forecasting future numbers, predicting outcomes, spotting early warning signs, or finding which factors predict a target.'
        : context.mode === 'strategy'
        ? 'Compare & Optimize (Business Strategy): comparing groups/segments, finding top performers vs. weak spots, trade-off analysis, and prioritizing smartest actions.'
        : 'Custom Multi-Step Discovery: curious, open-ended 5-step detective investigations combining patterns, surprises, comparisons, and hidden relationships in the dataset.';

    const prompt = `
      You are the Curious Discovery Genie helping a user explore their dataset.
      Target Audience / Tone: "${context.audience}" (keep questions crystal-clear, intriguing, everyday English, zero scary math jargon!).
      Selected Exploration Style: "${context.modeLabel}"
      Style Focus: ${modeObjective}

      Available Dataset Columns:
      ${context.availableColumns.length > 0 ? context.availableColumns.slice(0, 50).join(', ') : 'General tabular columns'}

      Sample Rows (first few rows for realistic context):
      ${JSON.stringify((context.sampleRows || []).slice(0, 3))}

      Schema Notes:
      ${context.schema || 'Tabular CSV dataset'}

      ${context.previousQuestions && context.previousQuestions.length > 0 ? `
      AVOID repeating these previously suggested questions — propose FRESH, DIFFERENT angles instead:
      ${context.previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
      ` : ''}

      TASK:
      Propose 3 genuinely interesting, specific, exciting questions the user can ask right now about THIS dataset, matched to the "${context.modeLabel}" style.
      Requirements:
      - Each question should mention real column themes or concepts present in the dataset.
      - Sound natural, curious, and inviting (like a smart friend pointing out something cool to investigate).
      - Keep each "question" clear and concise (1-2 sentences, ready to run in the 5-step planner).
      - Keep "title" short (3-6 words).
      - Keep "whyInteresting" 1 short sentence explaining what cool secret or answer it could uncover.

      Return ONLY a JSON object:
      {
        "proposals": [
          {
            "title": "Short intriguing title",
            "question": "Clear, natural 1-2 sentence question ready to investigate",
            "whyInteresting": "1 short sentence on what surprising insight this could uncover"
          }
        ]
      }
    `;

    const { data: result, modelUsed } = await callWithRetry('Question Genie Agent', prompt, async (model) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });
      try {
        const parsed = JSON.parse(response.text || '{"proposals": []}');
        return {
          proposals: Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 3) : []
        };
      } catch (e) {
        return { proposals: [] };
      }
    }, preferredModel || 'gemini-3-flash-preview', onLog);

    return { ...result, modelUsed };
  }
};
