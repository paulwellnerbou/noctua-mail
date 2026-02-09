import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { IconButton, TextField } from "@radix-ui/themes";

type PasswordFieldProps = Omit<ComponentProps<typeof TextField.Root>, "type">;

export default function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField.Root {...props} type={visible ? "text" : "password"}>
      <TextField.Slot side="right">
        <IconButton
          type="button"
          size="1"
          variant="ghost"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </IconButton>
      </TextField.Slot>
    </TextField.Root>
  );
}
