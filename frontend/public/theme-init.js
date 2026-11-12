// Terapkan tema sebelum React mount supaya tidak ada flash dark saat reload
// ketika pengguna memilih light/system. Key harus sama dengan ThemeProvider.
(() => {
	try {
		const stored = localStorage.getItem("pi-gui-theme");
		const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
		const resolved =
			stored === "light" || stored === "dark"
				? stored
				: stored === "system"
					? systemDark
						? "dark"
						: "light"
					: "dark";
		document.documentElement.classList.toggle("dark", resolved === "dark");
		document.documentElement.style.colorScheme = resolved;
	} catch {
		/* localStorage dibatasi browser; biarkan default dark */
	}
})();
