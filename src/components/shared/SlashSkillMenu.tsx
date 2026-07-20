import { memo } from 'react';
import type { SkillEntry } from '../../utils/skills';
import styles from './SlashSkillMenu.module.css';

export interface SlashSkillMenuProps {
  skills: SkillEntry[];
  highlightIndex: number;
  onHighlight: (index: number) => void;
  onSelect: (skill: SkillEntry) => void;
  label?: string;
}

const SlashSkillMenu = memo(function SlashSkillMenu({
  skills,
  highlightIndex,
  onHighlight,
  onSelect,
  label = 'Skills',
}: SlashSkillMenuProps) {
  if (skills.length === 0) return null;

  return (
    <div className={styles.menu} role="listbox" aria-label={label}>
      <ul className={styles.list}>
        {skills.map((skill, index) => {
          const active = index === highlightIndex;
          return (
            <li key={`${skill.scope}:${skill.name}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.item} ${active ? styles.itemActive : ''}`}
                onMouseEnter={() => onHighlight(index)}
                onMouseDown={(e) => {
                  // Prevent textarea blur before click selection.
                  e.preventDefault();
                }}
                onClick={() => onSelect(skill)}
              >
                <div className={styles.nameRow}>
                  <span className={styles.name}>/{skill.name}</span>
                  {skill.argumentHint ? (
                    <span className={styles.hint}>{skill.argumentHint}</span>
                  ) : null}
                </div>
                {skill.description ? (
                  <div className={styles.description} title={skill.description}>
                    {skill.description}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export default SlashSkillMenu;
