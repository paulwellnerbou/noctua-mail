import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { TextField } from "@radix-ui/themes";
import TooltipIconButton from "@/app/components/TooltipIconButton";

type PasswordFieldProps = Omit<ComponentProps<typeof TextField.Root>, "type">;

export default function PasswordField(props: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField.Root {...props} type={visible ? "text" : "password"}>
      <TextField.Slot side="right">
        <TooltipIconButton
          type="button"
          size="1"
          variant="ghost"
          onClick={() => setVisible((current) => !current)}
          tooltip={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </TooltipIconButton>
      </TextField.Slot>
    </TextField.Root>
  );
}
