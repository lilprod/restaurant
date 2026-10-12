import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Input, type InputProps } from "./ui/input";

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, "type" | "trailing">>((props, ref) => {
  const [show, setShow] = React.useState(false);
  return (
    <Input
      ref={ref}
      type={show ? "text" : "password"}
      {...props}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7"
          aria-label={show ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          aria-pressed={show}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
});
PasswordInput.displayName = "PasswordInput";
