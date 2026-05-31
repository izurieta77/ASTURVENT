Option Explicit

Dim shell, fso, rootPath, sourcePath, startupPath, destPath, logDir, logPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rootPath = "C:\super-cheap"
sourcePath = rootPath & "\start-backfill-2024-05-to-2026-05-30.vbs"
startupPath = shell.SpecialFolders("Startup")
destPath = startupPath & "\super-cheap-backfill-2024-05-to-2026-05-30.vbs"
logDir = rootPath & "\logs"
logPath = logDir & "\backfill-startup-install.log"

If Not fso.FolderExists(logDir) Then
  fso.CreateFolder(logDir)
End If

If Not fso.FileExists(sourcePath) Then
  AppendLog "No existe " & sourcePath
  WScript.Quit 1
End If

fso.CopyFile sourcePath, destPath, True
AppendLog "Instalado " & destPath

Sub AppendLog(message)
  Dim file
  Set file = fso.OpenTextFile(logPath, 8, True)
  file.WriteLine Now & " " & message
  file.Close
End Sub
