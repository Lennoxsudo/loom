import type { SVGProps } from 'react';

type ActivityIconProps = SVGProps<SVGSVGElement>;

const baseIconProps: ActivityIconProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
};

function ActivityIcon({ children, ...props }: ActivityIconProps) {
  return (
    <svg {...baseIconProps} {...props}>
      {children}
    </svg>
  );
}

/** VS Code codicon-files inspired explorer icon */
export function ExplorerActivityIcon(props: ActivityIconProps) {
  return (
    <ActivityIcon {...props}>
      <path
        d="M6 3.5h6.8L16 6.5H19.5A1.5 1.5 0 0 1 21 8v11.5A1.5 1.5 0 0 1 19.5 21H6A1.5 1.5 0 0 1 4.5 19.5V5A1.5 1.5 0 0 1 6 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 3.5V7.5H16.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 12.5H15.5M8 15.5H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </ActivityIcon>
  );
}

/** VS Code codicon-search inspired */
export function SearchActivityIcon(props: ActivityIconProps) {
  return (
    <ActivityIcon {...props}>
      <circle cx="10.75" cy="10.75" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </ActivityIcon>
  );
}

/** Classic git branch graph for source control */
export function SourceControlActivityIcon(props: ActivityIconProps) {
  return (
    <ActivityIcon {...props}>
      <circle cx="7.5" cy="6" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16.5" cy="12" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.5" cy="18" r="2.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M7.5 8.25V12M7.5 12H14.25M7.5 12V15.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </ActivityIcon>
  );
}

/** Agent / chat panel icon */
export function ChatActivityIcon(props: ActivityIconProps) {
  return (
    <ActivityIcon {...props}>
      <path
        d="M6.5 5.5H17.5C18.6 5.5 19.5 6.4 19.5 7.5V14.5C19.5 15.6 18.6 16.5 17.5 16.5H11.5L7.5 19.5V16.5H6.5C5.4 16.5 4.5 15.6 4.5 14.5V7.5C4.5 6.4 5.4 5.5 6.5 5.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 10H15.5M8.5 12.5H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </ActivityIcon>
  );
}

/** VS Code codicon-terminal inspired */
export function TerminalActivityIcon(props: ActivityIconProps) {
  return (
    <ActivityIcon {...props}>
      <path
        d="M5 6.5H19C20.1 6.5 21 7.4 21 8.5V16.5C21 17.6 20.1 18.5 19 18.5H5C3.9 18.5 3 17.6 3 16.5V8.5C3 7.4 3.9 6.5 5 6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10.5L10.5 13L7.5 15.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 15.5H16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </ActivityIcon>
  );
}

/** VS Code codicon-settings-gear inspired */
export function SettingsActivityIcon(props: ActivityIconProps) {
  return (
    <ActivityIcon {...props}>
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 4.25V6.25M12 17.75V19.75M19.75 12H17.75M6.25 12H4.25M17.3 6.7L15.9 8.1M8.1 15.9L6.7 17.3M17.3 17.3L15.9 15.9M8.1 8.1L6.7 6.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </ActivityIcon>
  );
}
