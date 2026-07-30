import { AmbientBackdrop } from "@/src/features/experience";
import { RouterProvider } from "@/src/router";
import { AppShell } from "./AppShell";

export function App() {
  return (
    <RouterProvider>
      <AmbientBackdrop />
      <AppShell />
    </RouterProvider>
  );
}
