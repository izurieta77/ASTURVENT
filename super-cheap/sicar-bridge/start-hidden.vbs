Option Explicit

Dim shell, fso, nodePath, rootPath, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

rootPath = "C:\super-cheap"
scriptPath = rootPath & "\daemon.js"
nodePath = "C:\Program Files\nodejs\node.exe"

If fso.FileExists(nodePath) Then
  command = """" & nodePath & """ """ & scriptPath & """"
Else
  command = "node.exe """ & scriptPath & """"
End If

shell.CurrentDirectory = rootPath
shell.Run command, 0, False
