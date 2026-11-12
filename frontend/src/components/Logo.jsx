import { cn } from "cn";

export default function Logo({ className }) {
	return (
		<span
			role="img"
			aria-label="MIAZAKI"
			title="MIAZAKI"
			data-logo="miazaki"
			className={cn("logo-mask inline-block w-auto shrink-0 select-none", className)}
		/>
	);
}
