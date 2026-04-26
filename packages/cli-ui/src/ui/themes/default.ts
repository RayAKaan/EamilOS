export const BorderTheme = {
  style: {
    panel: 'single' as const,
    section: 'single' as const,
    card: 'round' as const,
    input: 'double' as const,
    status: 'single' as const,
  },
  color: {
    active: 'cyan',
    inactive: 'gray',
    selected: 'yellow',
    error: 'red',
    success: 'green',
  }
};

export const getBorderConfig = (type: keyof typeof BorderTheme.style, isActive = false) => ({
  borderStyle: BorderTheme.style[type],
  borderColor: isActive ? BorderTheme.color.active : BorderTheme.color.inactive,
});