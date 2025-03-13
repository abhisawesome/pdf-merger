'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from '@heroicons/react/24/solid';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
      <button
        onClick={toggleTheme}
        className="fixed bottom-4 right-4 p-3 rounded-full bg-secondary hover:bg-secondary-hover transition-colors duration-200"
        aria-label="Toggle theme"
      >
        {theme === 'light' ? (
          <MoonIcon className="w-6 h-6 text-text-primary" />
        ) : (
          <SunIcon className="w-6 h-6 text-text-primary" />
        )}
      </button>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
} 