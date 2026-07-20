import { redirect } from "next/navigation";

export default function LegacyDemoAssetsRedirect() {
  redirect("/projects/demo/assets");
}
