import React from 'react';
import { Settings, User } from 'lucide-react';
import { Button } from './ui/button';

// Define a custom style type to include -webkit-app-region
type DraggableStyle = React.CSSProperties & {
  WebkitAppRegion?: 'drag' | 'no-drag';
};

export const TitleBar = () => {
  const draggableStyle: DraggableStyle = {
    WebkitAppRegion: 'drag',
  };

  const nonDraggableStyle: DraggableStyle = {
    WebkitAppRegion: 'no-drag',
  };

  return (
    <div className="h-14 flex items-center justify-between pl-20 pr-4 bg-muted border-b w-full fixed top-0 left-0 z-50" style={draggableStyle}>
      <div className="h-full w-full absolute top-0 left-0"/>
      <div className="flex items-center gap-2" style={nonDraggableStyle}>
      </div>
    </div>
  );
};