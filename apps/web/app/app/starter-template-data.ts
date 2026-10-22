export const starterTemplates = [
  {
    id: "saas",
    name: "SaaS landing page",
    description: "A polished product page with clear calls to action.",
    prompt: "Build a responsive SaaS landing page for [product name]. Include a strong hero, benefits, feature highlights, and a clear sign-up call to action. Ask for missing product details. Use clearly labeled placeholders for unverified information; do not invent pricing, testimonials, customer logos, or performance claims. Connect calls to action to real flows where available.",
  },
  {
    id: "crm",
    name: "CRM dashboard",
    description: "A practical customer and sales workspace.",
    prompt: "Build a responsive CRM dashboard for [business name]. Include a concise overview of pipeline, recent activity, customer records, and follow-up tasks. Use realistic sample data and make the main navigation and filters clear.",
  },
  {
    id: "store",
    name: "Online store",
    description: "A storefront with product discovery and details.",
    prompt: "Build a responsive online store for [brand] selling [products]. Include a branded home page, product grid with filters, product detail views, and a cart interaction. Use realistic sample products and prices; do not connect real payments.",
  },
  {
    id: "portfolio",
    name: "Portfolio",
    description: "A personal site for work, story, and contact.",
    prompt: "Build a responsive portfolio for [name], a [role]. Include a short introduction, selected projects with outcomes, experience, and contact details. Keep the design distinctive, readable, and easy to scan.",
  },
  {
    id: "study",
    name: "Study app",
    description: "A focused study space with progress and practice.",
    prompt: "Build a responsive study app for [subject]. Include a course or topic overview, study progress, flashcards, and a short practice quiz with immediate feedback. Use sample content and keep the study flow focused.",
  },
  {
    id: "ai-chat",
    name: "AI chat app",
    description: "A clean chat interface with conversation history.",
    prompt: "Build a responsive AI chat app for [audience/use case]. Include conversation history, a clear message composer, example prompts, loading, errors, and a polished empty state. Use the project's configured AI integration if available. Ask before adding a new provider or credentials, and clearly label any demo responses until a real integration is configured.",
  },
] as const;

export type StarterTemplateId = (typeof starterTemplates)[number]["id"];
