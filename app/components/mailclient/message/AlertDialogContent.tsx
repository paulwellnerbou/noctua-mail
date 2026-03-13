import { forwardRef } from "react";
import { AlertDialog } from "@radix-ui/themes";

type AlertDialogContentProps = React.ComponentPropsWithoutRef<typeof AlertDialog.Content>;
type AlertDialogContentElement = React.ElementRef<typeof AlertDialog.Content>;

const AlertDialogContent = forwardRef<
  AlertDialogContentElement,
  AlertDialogContentProps
>(function AlertDialogContent({ style, ...props }, ref) {
  return (
    <AlertDialog.Content
      ref={ref}
      style={{ width: "min(560px, 92vw)", ...style }}
      {...props}
    />
  );
});

export default AlertDialogContent;
