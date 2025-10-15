import React, { createContext, useState, useEffect, useContext, ReactNode } from 'react';

// 定义主题上下文类型
interface ThemeContextType {
  darkMode: boolean;
  toggleDarkMode: () => void;
}

// 创建主题上下文
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// 主题提供者组件的属性类型
interface ThemeProviderProps {
  children: ReactNode;
}

// 主题提供者组件
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // 初始化时从本地存储加载主题设置
  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedDarkMode);
    
    // 应用主题到body
    if (savedDarkMode) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, []);

  // 切换主题模式
  const toggleDarkMode = () => {
    const newDarkMode = !darkMode;
    setDarkMode(newDarkMode);
    localStorage.setItem('darkMode', newDarkMode.toString());
    
    // 应用主题到body
    if (newDarkMode) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  };

  return (
    <ThemeContext.Provider value={{ darkMode, toggleDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

// 自定义Hook，方便组件使用主题上下文
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// 导出主题上下文
export default ThemeContext;