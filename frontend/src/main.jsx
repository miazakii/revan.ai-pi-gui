import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
	<ThemeProvider
		attribute="class"
		defaultTheme="dark"
		enableSystem
		disableTransitionOnChange
		storageKey="pi-gui-theme"
	>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</ThemeProvider>,
);
