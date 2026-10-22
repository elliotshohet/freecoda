"use client";

import { starterTemplates, type StarterTemplateId } from "./starter-template-data";
import styles from "./starter-templates.module.css";

export function StarterTemplates({ onChoose }: { onChoose: (id: StarterTemplateId) => void }) {
  return (
    <section className={styles.section} aria-labelledby="starter-templates-title">
      <div className={styles.heading}>
        <h2 id="starter-templates-title">Start with a template</h2>
        <p>Choose one to add a prompt to your draft.</p>
      </div>
      <div className={styles.grid}>
        {starterTemplates.map((template) => (
          <button className={styles.card} key={template.id} type="button" onClick={() => onChoose(template.id)}>
            <strong>{template.name}</strong>
            <span>{template.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
