@echo off
rem Run a command with the MSVC dev environment (INCLUDE/LIB) loaded.
rem Needed for crates that compile C code (e.g. zstd-sys); plain Rust builds
rem don't require this. Usage: scripts\vs.cmd <command...>
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
%*
