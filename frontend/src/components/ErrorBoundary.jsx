import { Component } from "react";

export default class ErrorBoundary extends Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	componentDidCatch(error, info) {
		console.error("[pi-gui] render error", error, info?.componentStack);
	}

	render() {
		if (!this.state.error) return this.props.children;
		return (
			<div className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
				<div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
					<h1 className="text-base font-semibold">UI gagal dirender</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Terjadi error di frontend. Sesi pi tetap berjalan di server; muat ulang
						halaman untuk menyambung kembali.
					</p>
					<pre className="mt-3 max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
						{String(this.state.error?.message ?? this.state.error)}
					</pre>
					<button
						type="button"
						className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
						onClick={() => location.reload()}
					>
						Muat Ulang
					</button>
				</div>
			</div>
		);
	}
}
