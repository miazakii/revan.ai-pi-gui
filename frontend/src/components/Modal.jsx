import { useRef } from "react";
import { cn } from "cn";

import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function buttonVariant(variant) {
	if (variant === "primary") return "default";
	if (variant === "danger") return "destructive";
	if (variant === "ghost") return "ghost";
	return "outline";
}

function buttonClass(variant) {
	if (variant === "primary") return "primary";
	if (variant === "danger") return "danger";
	if (variant === "ghost") return "ghost";
	return "";
}

function ModalInput({ input, inputRef }) {
	const label = input?.label ?? (input?.multiline ? "Isi" : "Nama");
	return (
		<div className="grid gap-2">
			<Label htmlFor="modal-input">{label}</Label>
			{input?.multiline ? (
				<Textarea
					id="modal-input"
					ref={inputRef}
					rows={input.rows ?? 12}
					placeholder={input?.placeholder ?? ""}
					defaultValue={input?.value ?? ""}
					autoFocus
					className="resize-y font-mono text-sm"
				/>
			) : (
				<Input
					id="modal-input"
					ref={inputRef}
					type="text"
					spellCheck={false}
					placeholder={input?.placeholder ?? ""}
					defaultValue={input?.value ?? ""}
					autoFocus
					aria-label={label}
				/>
			)}
		</div>
	);
}

function DialogButtons({ buttons, onPick, fullWidth = false }) {
	return (
		<>
			{buttons.map((spec, index) => (
				<Button
					key={`${spec.label}-${index}`}
					variant={buttonVariant(spec.variant)}
					className={cn(
						fullWidth ? "w-full justify-start" : "w-auto",
						buttonClass(spec.variant),
					)}
					onClick={() => onPick(spec)}
				>
					{spec.label}
				</Button>
			))}
		</>
	);
}

export default function DialogHost({ modal, onClose }) {
	const inputRef = useRef(null);

	if (!modal) return null;

	const finish = (spec) => {
		// Baca nilai langsung dari DOM agar input uncontrolled tetap kompatibel
		// dengan pemanggilan programmatic (mis. tes headless).
		const currentValue = inputRef.current ? inputRef.current.value : "";
		const value =
			typeof spec.value === "function" ? spec.value(currentValue) : spec.value;
		onClose(value);
	};

	const handleOpenChange = (open) => {
		if (!open) onClose(undefined);
	};

	const inputBlock = modal.input ? (
		<ModalInput input={modal.input} inputRef={inputRef} />
	) : null;
	const stacked = !modal.input && modal.buttons.length > 2;

	if (modal.alert) {
		return (
			<AlertDialog open onOpenChange={handleOpenChange}>
				<AlertDialogContent id="modal" className="sm:max-w-md">
					<AlertDialogHeader>
						<AlertDialogTitle>{modal.title ?? "Konfirmasi"}</AlertDialogTitle>
						{modal.message ? (
							<AlertDialogDescription className="whitespace-pre-wrap">
								{modal.message}
							</AlertDialogDescription>
						) : (
							<AlertDialogDescription className="sr-only">
								Konfirmasi tindakan ini.
							</AlertDialogDescription>
						)}
					</AlertDialogHeader>
					{inputBlock}
					<AlertDialogFooter
						className={cn("gap-2", stacked && "flex-col sm:flex-col sm:justify-start sm:space-x-0")}
					>
						<DialogButtons
							buttons={modal.buttons}
							onPick={finish}
							fullWidth={stacked}
						/>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	}

	return (
		<Dialog open onOpenChange={handleOpenChange}>
			<DialogContent id="modal" className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{modal.title ?? "Dialog"}</DialogTitle>
					{modal.message ? (
						<DialogDescription className="whitespace-pre-wrap">
							{modal.message}
						</DialogDescription>
					) : (
						<DialogDescription className="sr-only">
							Isi dialog berikut lalu pilih tindakan.
						</DialogDescription>
					)}
				</DialogHeader>
				{inputBlock}
				<DialogFooter
					className={cn("gap-2", stacked && "flex-col sm:flex-col sm:justify-start sm:space-x-0")}
				>
					<DialogButtons
						buttons={modal.buttons}
						onPick={finish}
						fullWidth={stacked}
					/>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
