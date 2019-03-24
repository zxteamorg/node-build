# ZXBuild (ZXTeam's Build Tool)
The tool is a helper to automate build of TypeScrpt-based projects.
Main reason of the tool is to keep same structure of all our projects.

## Use cases
```bash
# Crean workspace
$ zxbuild clean

# Compile
$ zxbuild compile

# Make distributive
$ zxbuild dist
```

## Project structure
### Library
```
├─ my-library
│  ├─ .vscode
│  ├─ src
│  └─ test
```
### Service
```
├─ my-service
│  ├─ .vscode
│  ├─ src
│  └─ test
```
### Application
```
├─ my-application
│  ├─ .vscode
│  ├─ src.common
│  ├─ src.client
│  ├─ src.host
│  └─ test
```
