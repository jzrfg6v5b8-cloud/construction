import { AppShell } from "@/components/app-shell";
import { SketchUpConnection } from "@/components/sketchup-connection";
import { DemoNotice } from "@/components/ui";

export default function SketchUpSettingsPage() {
  return (
    <AppShell
      current="sketchup"
      title="SketchUp＋LayOut 集成设置"
      description="配置只在本机运行的桥接服务、SketchUp Extension、组件库与LayOut交接目录。"
    >
      <DemoNotice>
        浏览器不能直接控制 SketchUp。插件必须主动连接只监听 127.0.0.1 的桥接服务；LayOut 仍需人工打开模板并刷新模型引用。
      </DemoNotice>
      <div className="mt-5"><SketchUpConnection /></div>
    </AppShell>
  );
}
