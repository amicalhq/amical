import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      forcedTheme="dark"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
