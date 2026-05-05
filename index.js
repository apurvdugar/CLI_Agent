import "dotenv/config";
import { OpenAI } from "openai";
import { exec } from "child_process";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import systemPrompt from "./system_prompt.js";
import axios from "axios";
import * as cheerio from "cheerio";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

const tools = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          content: { type: "string" }
        },
        required: ["filename", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read content from a file",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" }
        },
        required: ["filename"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "open_browser",
      description: "Open the generated HTML file in a browser",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "The HTML file to open" }
        },
        required: ["filename"]
      }
    }
  },
  // Tool definition — add to your tools array
  {
    type: "function",
    function: {
      name: "scrape_website",
      description: "Scrapes a website and returns its HTML structure, extracted CSS content, design tokens (colors, fonts), copy, navigation links, and section layout. Always call this first before cloning any website.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The full URL of the website to scrape (e.g., https://www.scaler.com)"
          }
        },
        required: ["url"]
      }
    }
  }
];

async function callLLM(messages, retries = 3) {
  try {
    return await client.chat.completions.create({
      model: "openai/gpt-oss-120b:free",
      messages,
      tools,
      tool_choice: "auto",
    });
  } catch (err) {
    if (err.status === 429 && retries > 0) {
      const delay = (4 - retries) * 2000;
      console.log(`Rate limited. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return callLLM(messages, retries - 1);
    }
    throw err;
  }
}

async function handleToolCalls(toolCalls) {
  const toolMessages = [];
  for (const toolCall of toolCalls) {
    const { name, arguments: argsJson } = toolCall.function;
    const args = JSON.parse(argsJson);
    console.log(`\nCalling tool: ${name} with arguments: ${argsJson}`);
    
    let result = "";
    try {
      if (name === "write_file") {
        await fs.mkdir(path.dirname(args.filename), { recursive: true });
        await fs.writeFile(args.filename, args.content, "utf-8");
        result = `Successfully wrote to ${args.filename}`;
      } else if (name === "read_file") {
        result = await fs.readFile(args.filename, "utf-8");
      } else if (name === "open_browser") {
        const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
        exec(`${openCmd} ${args.filename}`);
        result = `Successfully opened ${args.filename} in browser.`;
      } else if (name === "scrape_website") {
        result = await scrapeWebsite(args);
      } else {
        result = `Unknown tool: ${name}`;
      }
    } catch (e) {
      result = `Error executing tool: ${e.message}`;
    }
    console.log(`Tool result: ${result}\n`);
    toolMessages.push({
      tool_call_id: toolCall.id,
      role: "tool",
      name: name,
      content: result,
    });
  }
  return toolMessages;
}

async function scrapeWebsite(targetUrl) {
  try {
    const targetUrlStr =
      typeof targetUrl === "object"
        ? targetUrl.url || targetUrl.URL
        : targetUrl;

    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    };

    const axiosGet = async (url) => {
      const { data } = await axios.get(url, { headers, timeout: 15000 });
      return data;
    };

    // ── STEP 1: Fetch main HTML ───────────────────────────────────────────────
    console.log(`  Fetching HTML from ${targetUrlStr}...`);
    const rawHTML = await axiosGet(targetUrlStr);
    const $ = cheerio.load(rawHTML);

    // ── STEP 2: Resolve all CSS file URLs ─────────────────────────────────────
    const cssUrls = [];
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href) {
        try { cssUrls.push(new URL(href, targetUrlStr).href); } catch (_) {}
      }
    });

    // ── STEP 3: Resolve all JS file URLs ──────────────────────────────────────
    const jsUrls = [];
    $("script[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (src) {
        try { jsUrls.push(new URL(src, targetUrlStr).href); } catch (_) {}
      }
    });

    // ── STEP 4: Fetch CSS files (up to 5) ─────────────────────────────────────
    console.log(`  Found ${cssUrls.length} CSS files. Fetching up to 5...`);
    const cssFiles = [];
    for (const cssUrl of cssUrls.slice(0, 5)) {
      try {
        const content = await axiosGet(cssUrl);
        cssFiles.push({
          url: cssUrl,
          // Cap each file at 8000 chars to avoid token overflow
          content: typeof content === "string"
            ? content.slice(0, 8000)
            : JSON.stringify(content).slice(0, 8000),
        });
        console.log(`  ✓ CSS: ${cssUrl}`);
      } catch (e) {
        console.log(`  ✗ CSS failed: ${cssUrl} — ${e.message}`);
        cssFiles.push({ url: cssUrl, content: `/* Failed to fetch: ${e.message} */` });
      }
    }

    // ── STEP 5: Fetch JS files (up to 3, skip CDN/analytics noise) ───────────
    console.log(`  Found ${jsUrls.length} JS files. Fetching relevant ones...`);
    const skipPatterns = [
      "analytics", "gtag", "google-tag", "facebook", "hotjar",
      "intercom", "crisp", "zendesk", "sentry", "datadog",
      "cdn.jsdelivr", "cdnjs.cloudflare", "unpkg.com"
    ];
    const relevantJsUrls = jsUrls.filter(
      (u) => !skipPatterns.some((pattern) => u.includes(pattern))
    );

    const jsFiles = [];
    for (const jsUrl of relevantJsUrls.slice(0, 3)) {
      try {
        const content = await axiosGet(jsUrl);
        jsFiles.push({
          url: jsUrl,
          content: typeof content === "string"
            ? content.slice(0, 6000)
            : JSON.stringify(content).slice(0, 6000),
        });
        console.log(`  ✓ JS: ${jsUrl}`);
      } catch (e) {
        console.log(`  ✗ JS failed: ${jsUrl} — ${e.message}`);
        jsFiles.push({ url: jsUrl, content: `// Failed to fetch: ${e.message}` });
      }
    }

    // ── STEP 6: Clean & trim the HTML ─────────────────────────────────────────
    // Resolve all image srcs to absolute before cleaning
    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src) {
        try { $(el).attr("src", new URL(src, targetUrlStr).href); } catch (_) {}
      }
    });

    // Remove only non-structural noise — keep style/link for HTML context
    $("script, svg, noscript, iframe").remove();

    const cleanedHTML = ($("html").html() || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);

    // ── ASSEMBLE RESULT ───────────────────────────────────────────────────────
    return JSON.stringify({
      status: "success",
      url: targetUrlStr,
      files: {
        html: {
          url: targetUrlStr,
          content: cleanedHTML,
        },
        css: cssFiles,
        js: jsFiles,
      },
      summary: {
        cssFilesFound: cssUrls.length,
        cssFilesFetched: cssFiles.filter(f => !f.content.startsWith("/*")).length,
        jsFilesFound: jsUrls.length,
        jsFilesFetched: jsFiles.filter(f => !f.content.startsWith("//")).length,
      }
    }, null, 2);

  } catch (e) {
    return JSON.stringify({
      status: "failed",
      message: e.message || String(e),
      tip: "Ensure the URL includes https://. Some sites block scrapers — try with a different URL.",
    });
  }
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    }
  ];

  console.log("Conversational CLI Agent started. Type 'exit' to quit.");

  const askQuestion = () => {
    rl.question("\nYou: ", async (userInput) => {
      if (userInput.toLowerCase() === "exit") {
        rl.close();
        return;
      }

      messages.push({ role: "user", content: userInput });

      let isDone = false;
      while (!isDone) {
        console.log("Agent is thinking...");
        try {
          const response = await callLLM(messages);
          const responseMessage = response.choices[0].message;

          if (responseMessage.content) {
            console.log(`\nAgent: ${responseMessage.content}`);
          }
          
          messages.push(responseMessage);

          if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolResults = await handleToolCalls(responseMessage.tool_calls);
            messages.push(...toolResults);
          } else {
            isDone = true;
          }
        } catch (e) {
          console.error("Error communicating with LLM:", e.message);
          isDone = true;
        }
      }
      
      askQuestion();
    });
  };

  askQuestion();
}

main();