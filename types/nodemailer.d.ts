declare module "nodemailer" {
  export function createTransport(options: any): {
    sendMail(message: any): Promise<void>;
  };
}
