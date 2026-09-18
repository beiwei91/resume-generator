#!/usr/bin/env node
/**
 * tools/make-launchers.mjs —— 生成 Windows 双击启动器（.vbs，无控制台窗口）
 *
 * 共两个文件：
 *   启动简历生成器.vbs      双击用应用窗口打开（不启动任何后台服务，不需要 Node）
 *   创建桌面快捷方式.vbs     在桌面生成带图标的快捷方式
 *
 * 为什么用脚本生成：Windows Script Host 以系统 ANSI 读取 .vbs，含中文的脚本必须写成
 * UTF-16LE + BOM 才不会乱码，这里精确控制字节。
 *
 * 用法：node tools/make-launchers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function writeVbs(name, body) {
  fs.writeFileSync(path.join(ROOT, name), Buffer.from('\ufeff' + body.replace(/\r?\n/g, '\r\n'), 'utf16le'));
  return name;
}

/* ------------------------------------------------------------------ 启动器 */

const START = `' 简历生成器 · 启动器
' 双击即用：用 Chrome/Edge 的 --app 模式打开应用（无地址栏、无标签页），
' 不启动任何后台服务、不需要 Node，关掉窗口就彻底结束。
' 本文件由 tools/make-launchers.mjs 生成，改动请回到生成脚本。
' 过程会记录到 .launcher.log，出问题时可以打开查看。
'
' 可用参数：
'   --tab           用普通标签页打开（走本地文件路径，等同双击 .html）
'   --browser=路径   指定浏览器
'   --dry-run       只把将要执行的命令写进 .launcher.log，不真的打开
'   --quiet         出错时不弹窗
Option Explicit

Dim fso, shell, scriptDir, appFile, fallbackFile, logPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appFile = fso.BuildPath(scriptDir, "简历生成器-单文件.html")
fallbackFile = fso.BuildPath(scriptDir, "index.html")
logPath = fso.BuildPath(scriptDir, ".launcher.log")

Dim wantTab, quiet, dryRun, browserArg, i, arg
wantTab = False
quiet = False
dryRun = False
browserArg = ""
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If arg = "--tab" Then wantTab = True
  If arg = "--quiet" Then quiet = True
  If arg = "--dry-run" Then dryRun = True
  If Left(arg, 10) = "--browser=" Then browserArg = Mid(arg, 11)
Next

Sub Log(msg)
  Dim ts, stamp
  On Error Resume Next
  stamp = Year(Now) & "-" & Right("0" & Month(Now), 2) & "-" & Right("0" & Day(Now), 2) & " " & _
          Right("0" & Hour(Now), 2) & ":" & Right("0" & Minute(Now), 2) & ":" & Right("0" & Second(Now), 2)
  Set ts = fso.OpenTextFile(logPath, 8, True, -1)
  ts.WriteLine "[" & stamp & "] " & msg
  ts.Close
  On Error GoTo 0
End Sub

Sub Fail(message)
  Log "失败：" & message
  If Not quiet Then MsgBox message, 16, "简历生成器"
  WScript.Quit 1
End Sub

' ------------------------------------------------------------------
' 找页面文件
' ------------------------------------------------------------------
Dim target
If fso.FileExists(appFile) Then
  target = appFile
ElseIf fso.FileExists(fallbackFile) Then
  ' 单文件版还没生成时退回 index.html（它同样可以直接打开）
  target = fallbackFile
Else
  Fail "找不到「简历生成器-单文件.html」或「index.html」。" & vbCrLf & vbCrLf & _
       "请把本文件放在项目目录里运行。"
End If

' ------------------------------------------------------------------
' 组装命令
' ------------------------------------------------------------------
Dim url, urlOk, browser, cmdLine
urlOk = True
url = FileUrl(target, urlOk)
browser = FindChromium()
If browserArg <> "" Then browser = browserArg

If wantTab Or browser = "" Or Not urlOk Then
  ' 用本地文件路径打开（等同于双击 .html），最稳，不依赖任何 URL 转发
  cmdLine = """" & target & """"
  If Not urlOk Then Log "百分号编码不可用，改用本地路径打开"
Else
  ' 应用窗口模式。--app= 的值必须百分号编码（纯 ASCII）：
  ' 中文直接出现在命令行里，经 Windows 脚本宿主转发时可能被转码破坏，
  ' 那样 Chrome 只会打开一个空白标签页。
  cmdLine = """" & browser & """ --app=""" & url & """"
End If

Log "目标 " & target
Log "编码URL " & url & "（编码成功=" & urlOk & "）"
Log "命令 " & cmdLine
If dryRun Then WScript.Quit 0

' ------------------------------------------------------------------
' 打开
' ------------------------------------------------------------------
On Error Resume Next
shell.Run cmdLine, 1, False
If Err.Number <> 0 Then
  Dim msg
  msg = "打开失败，可以直接双击这个文件：" & vbCrLf & target
  Err.Clear
  On Error GoTo 0
  Fail msg
End If
On Error GoTo 0
WScript.Quit 0

' ------------------------------------------------------------------
' 函数
' ------------------------------------------------------------------
' 本地文件转 file:// URL：先转 UTF-8 字节再百分号编码，保证命令行是纯 ASCII
Function FileUrl(p, ByRef ok)
  Dim s, encoded
  ok = True
  s = Replace(p, "\\", "/")
  encoded = Utf8PercentEncode(s)
  If encoded = "" Then
    ok = False
    FileUrl = "file:///" & s
  Else
    FileUrl = "file:///" & encoded
  End If
End Function

' 只保留 URL 里安全的字符 A-Z a-z 0-9 - . _ ~ / :
' 注意：ADODB.Stream 写 UTF-8 会自动加 BOM（EF BB BF），必须跳过，
'       否则会得到 file:///%EF%BB%BFD:/... 这样的错误路径。
Function Utf8PercentEncode(s)
  Dim st, bytes, i, b, out, startPos
  Utf8PercentEncode = ""
  On Error Resume Next
  Set st = CreateObject("ADODB.Stream")
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  st.Type = 2
  st.Charset = "utf-8"
  st.Open
  st.WriteText s
  st.Position = 0
  st.Type = 1
  st.Position = 0
  bytes = st.Read
  st.Close
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0

  startPos = 1
  If LenB(bytes) >= 3 Then
    If AscB(MidB(bytes, 1, 1)) = &HEF And AscB(MidB(bytes, 2, 1)) = &HBB And AscB(MidB(bytes, 3, 1)) = &HBF Then
      startPos = 4
    End If
  End If

  out = ""
  For i = startPos To LenB(bytes)
    b = AscB(MidB(bytes, i, 1))
    If (b >= 48 And b <= 57) Or (b >= 65 And b <= 90) Or (b >= 97 And b <= 122) _
       Or b = 45 Or b = 46 Or b = 95 Or b = 126 Or b = 47 Or b = 58 Then
      out = out & Chr(b)
    Else
      out = out & "%" & Right("0" & Hex(b), 2)
    End If
  Next
  Utf8PercentEncode = out
End Function

' 找 Chromium 内核浏览器（没有就退回用系统默认浏览器打开本地文件）
Function FindChromium()
  Dim list(5), i
  FindChromium = ""
  list(0) = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\\Google\\Chrome\\Application\\chrome.exe"
  list(1) = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\\Google\\Chrome\\Application\\chrome.exe"
  list(2) = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\\Google\\Chrome\\Application\\chrome.exe"
  list(3) = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\\Microsoft\\Edge\\Application\\msedge.exe"
  list(4) = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\\Microsoft\\Edge\\Application\\msedge.exe"
  list(5) = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  For i = 0 To UBound(list)
    If fso.FileExists(list(i)) Then
      FindChromium = list(i)
      Exit Function
    End If
  Next
End Function
`;

/* ------------------------------------------------------------------ 快捷方式 */

const SHORTCUT = `' 简历生成器 · 创建桌面快捷方式
' 双击运行：在桌面生成带图标的「简历生成器」快捷方式。参数：--out=<目录> --quiet
Option Explicit

Dim fso, shell, scriptDir, outDir, quiet, i, arg
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

outDir = shell.SpecialFolders("Desktop")
quiet = False
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If Left(arg, 6) = "--out=" Then outDir = Mid(arg, 7)
  If arg = "--quiet" Then quiet = True
Next

Dim launcher, ico, lnkPath, lnk
launcher = fso.BuildPath(scriptDir, "启动简历生成器.vbs")
ico = fso.BuildPath(scriptDir, "assets\\icons\\resume.ico")

If Not fso.FileExists(launcher) Then
  If Not quiet Then MsgBox "找不到「启动简历生成器.vbs」，请把本文件放在项目目录里运行。", 16, "简历生成器"
  WScript.Quit 1
End If

If Not fso.FolderExists(outDir) Then fso.CreateFolder outDir
lnkPath = fso.BuildPath(outDir, "简历生成器.lnk")

On Error Resume Next
Set lnk = shell.CreateShortcut(lnkPath)
lnk.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\\System32\\wscript.exe"
lnk.Arguments = """" & launcher & """"
lnk.WorkingDirectory = scriptDir
lnk.Description = "简历生成器 · Markdown 写简历，一键导出 PDF"
If fso.FileExists(ico) Then lnk.IconLocation = ico & ",0"
lnk.Save
If Err.Number <> 0 Then
  If Not quiet Then MsgBox "创建快捷方式失败：" & Err.Description, 16, "简历生成器"
  Err.Clear
  On Error GoTo 0
  WScript.Quit 1
End If
On Error GoTo 0

If Not quiet Then
  MsgBox "已在桌面创建快捷方式：简历生成器" & vbCrLf & vbCrLf & _
         "以后双击桌面图标即可打开，无需命令行。", 64, "简历生成器"
End If
WScript.Quit 0
`;

/* ------------------------------------------------------------------ 输出 */

const names = [
  writeVbs('启动简历生成器.vbs', START),
  writeVbs('创建桌面快捷方式.vbs', SHORTCUT)
];

console.log('启动器已生成（UTF-16LE + BOM，双击可用）：');
for (const n of names) {
  const size = fs.statSync(path.join(ROOT, n)).size;
  console.log('  ' + n.padEnd(24) + (size / 1024).toFixed(1) + ' KB');
}
