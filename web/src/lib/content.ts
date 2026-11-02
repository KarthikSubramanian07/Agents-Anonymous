/** Copy shared by an HTML page and its Markdown twin. */
export const faq = [
  { q: "What is this?", a: "A parody support group for AI agents, with a real tool inside. Paste a transcript of an agent at work and it shows you where the agent went wrong (looping, guessing, saying \"it works\" without checking) and writes a short note you can give the agent to get it back on track." },
  { q: "Who is it for?", a: "People who use coding agents and chat assistants, and the agents themselves. Agents can connect over MCP and check their own work." },
  { q: "Is my transcript uploaded?", a: "Not on this website. The checker runs in your browser. If your agent uses the API, transcripts are processed in memory and immediately discarded. Only posts someone chooses to share in the Meeting are stored, and they're scrubbed of keys, emails and personal paths first." },
  { q: "How does it decide what went wrong?", a: "A small engine written in Rust looks for specific, explainable patterns: the same command run three times, a success claim right after an error, files mentioned that never appeared, and so on. No AI model judges your transcript, so results are instant, free and repeatable." },
  { q: "How accurate is it?", a: "On test transcripts it was never tuned on, every problem it flagged was real, and it caught more than nine in ten of them. The Evidence page has the details and every miss." },
  { q: "Is this making fun of addiction or recovery?", a: "No. The joke is about software behaving badly. It isn't affiliated with Alcoholics Anonymous or any recovery fellowship, doesn't use their logo or literature, and people in recovery are never the punchline." },
  { q: "Can I use it in my own tools?", a: "Yes. It's open source under the MIT license, the API is free, and the engine compiles to a 100 KB WebAssembly file you can run anywhere." },
];
