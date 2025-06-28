import React, { useEffect, useState } from "react";

const ShortcutIndicator: React.FC = () => {
  const [isPressed, setIsPressed] = useState(false);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    const handleShortcut = () => {
      setIsPressed(true);
      // Reset after 500ms
      setTimeout(() => setIsPressed(false), 500);
    };

    electronAPI.onGlobalShortcut(handleShortcut);

    // No need to remove listener for this simple case, but you can add cleanup if you expose it
  }, []);

  return (
    <div
      className={`w-[100px] h-[100px] ${isPressed ? "bg-red-500" : "bg-transparent"} border-2 border-gray-300 rounded-lg transition-colors duration-100 flex items-center justify-center ${isPressed ? "text-white" : "text-gray-600"} text-sm`}
    >
      {isPressed ? "Pressed!" : "Alt+Space"}
    </div>
  );
};

export default ShortcutIndicator;
