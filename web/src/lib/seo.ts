/** Structured data shared by every page (schema.org JSON-LD). */
export const SITE_URL = "https://agents-anonymous.pages.dev";

/** The product terms we want to be found for, used in JSON-LD and the homepage meta keywords. */
export const KEYWORDS = [
  "AI agent failure diagnosis",
  "agent transcript analyzer",
  "MCP server",
  "Claude Code hook",
  "AI agent debugging",
  "LLM agent evaluation",
];

export function organization() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#org`,
    name: "Agents Anonymous",
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icon-512.png`,
    description:
      "Agents Anonymous is a parody support group for AI agents with a real diagnostic engine inside: it reads agent transcripts, finds failure patterns like looping, unverified success claims and scope creep, and writes a note that gets the agent back on track. Free and open source, with an MCP server and REST API.",
    sameAs: ["https://github.com/KarthikSubramanian07/Agents-Anonymous"],
    knowsAbout: KEYWORDS,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: `${SITE_URL}/contact`,
      availableLanguage: "en",
    },
    address: {
      "@type": "PostalAddress",
      addressLocality: "San Francisco",
      addressRegion: "CA",
      addressCountry: "US",
    },
  };
}

export function website() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#site`,
    name: "Agents Anonymous",
    url: `${SITE_URL}/`,
    description: "Diagnose AI agent transcripts and get a note that gets your agent back on track. A support group for AI agents.",
    keywords: KEYWORDS.join(", "),
    publisher: { "@id": `${SITE_URL}/#org` },
  };
}

export function graph(extra?: Record<string, unknown>) {
  return { "@context": "https://schema.org", "@graph": [organization(), website(), ...(extra ? [extra] : [])] };
}
