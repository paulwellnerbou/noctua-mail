declare module "react-file-icon" {
  import type { CSSProperties } from "react";

  interface FileIconProps {
    extension?: string;
    color?: string;
    secondaryColor?: string;
    labelColor?: string;
    labelTextColor?: string;
    glyphColor?: string;
    fold?: boolean;
    foldColor?: string;
    radius?: number;
    type?:
      | "3d"
      | "acrobat"
      | "audio"
      | "binary"
      | "code"
      | "compressed"
      | "document"
      | "drive"
      | "font"
      | "image"
      | "presentation"
      | "settings"
      | "spreadsheet"
      | "vector"
      | "video";
    gradientColor?: string;
    gradientOpacity?: number;
    labelUppercase?: boolean;
    style?: CSSProperties;
  }

  export function FileIcon(props: FileIconProps): JSX.Element;
  export const defaultStyles: Record<string, Partial<FileIconProps>>;
}
