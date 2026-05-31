Option Explicit

Dim shell, fso, rootPath, scriptPath, nodePath, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rootPath = "C:\super-cheap"
scriptPath = rootPath & "\backfill.js"
nodePath = "C:\Program Files\nodejs\node.exe"

If fso.FileExists(nodePath) Then
  command = """" & nodePath & """ """ & scriptPath & """ 2024-05-01 2026-05-30 --reset --wait"
Else
  command = "node.exe """ & scriptPath & """ 2024-05-01 2026-05-30 --reset --wait"
End If

shell.CurrentDirectory = rootPath
shell.Run command, 0, False
