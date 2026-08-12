import type { Metadata } from "next";
import { DesktopOutlined, MobileOutlined } from "@ant-design/icons";

export const metadata: Metadata = {
  title: "Access Restricted | Gaandiva CRM",
  description:
    "Gaandiva CRM is currently accessible only from desktop or laptop devices.",
};

export default function MobileNotSupportedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-[#e5e7eb] bg-white p-8 shadow-sm sm:p-10">
        <div className="mb-6 flex items-center justify-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fef2f2] text-[#dc2626]">
            <MobileOutlined className="text-2xl" />
          </span>
          <span className="text-[#9ca3af]">→</span>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ecfdf5] text-[#059669]">
            <DesktopOutlined className="text-2xl" />
          </span>
        </div>

        <h1 className="text-center text-2xl font-semibold tracking-tight text-[#111827]">
          Access Restricted
        </h1>

        <p className="mt-4 text-center text-base leading-7 text-[#4b5563]">
          Gaandiva CRM is currently accessible only from desktop, laptop, or iPad devices.
          Please use a Windows, Mac, Linux computer, or an iPad to access the platform.
        </p>

        <div className="mt-8 rounded-xl bg-[#f9fafb] px-4 py-3 text-center text-sm text-[#6b7280]">
          Supported devices: Windows PC, Mac, Linux desktop/laptop, or iPad
        </div>
      </div>
    </main>
  );
}
