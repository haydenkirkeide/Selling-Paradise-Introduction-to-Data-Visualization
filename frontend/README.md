# README

## This site runs on local host. 
To run the backend of the project-
- cd ~<"path to your machine">/backend
- In the terminal, run "python api.py"
- This launches the JSON file with the house information
- NOTE: you may need to append "/api/houses" to the server HTTP site after "5001"
- If you would like, you can shift click OR copy and paste the port 5001 server into Google Chrome to ensure that the server has deployed correctly

To run the frontend of the project-
- Open a NEW terminal. DO NOT close the terminal running the backend
- Ensure the necessary packages are installed on your machine, and run "npm run dev" in the terminal
- Once you click on the localhost site, you can either keep running the tab in VSCode OR copy and paste it to Google Chrome for better visibility

For the best experience, once you launch the localhost site from the frontend terminal window, click and drag the localhost browser file out of the VSCode tab list into its own window. Make that window fullscreen and reload the site using the referesh button in the top lefthand corner. Once it refreshes, you will see the dashboard working to its fullest capacity. 

# Tip: in the Ocean Distance view, if you drag the brush from left to right, you can see prices generally go down as distance to the ocean decreases!
# If you have your eye on the Age Progression view, you can also see a huge spike in new build homes in the early 2000's.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
