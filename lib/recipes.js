// AstroPilot — Processing Recipe Sharing
// ==========================================
// Export and import processing recipes — complete snapshots of how
// an image was processed, including profile overrides, pipeline
// settings, and the score it achieved.
//
// Recipes are portable: you can share them with other AstroPilot
// users, post them alongside your images, or use them as starting
// points for similar targets.

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

const RECIPE_VERSION = 1;

function getRecipesDir() {
   return path.join(platform.getAstroPilotDir(), 'recipes');
}

function ensureDir(dir) {
   fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Create a recipe from a completed pipeline run
// ---------------------------------------------------------------------------

function createRecipe(name, options) {
   const recipe = {
      version: RECIPE_VERSION,
      name: name,
      description: options.description || null,
      author: options.author || null,
      createdAt: new Date().toISOString(),
      target: {
         name: options.targetName || null,
         type: options.targetType || null
      },
      profile: {
         name: options.profileName || null,
         stretch: options.stretch || null,
         combination: options.combination || null,
         processing: options.processing || null
      },
      pipeline: {
         linearSteps: options.linearSteps || [],
         creativeSteps: options.creativeSteps || [],
         overrides: options.overrides || {}
      },
      score: options.score || null,
      equipment: options.equipment || null,
      tags: options.tags || []
   };

   return recipe;
}

// ---------------------------------------------------------------------------
// Save / load / list / delete
// ---------------------------------------------------------------------------

function saveRecipe(recipe) {
   ensureDir(getRecipesDir());
   const safeName = recipe.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
   const filePath = path.join(getRecipesDir(), safeName + '.json');
   fs.writeFileSync(filePath, JSON.stringify(recipe, null, 2));
   return filePath;
}

function loadRecipe(name) {
   const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
   const filePath = path.join(getRecipesDir(), safeName + '.json');
   if (!fs.existsSync(filePath)) return null;
   try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
   } catch {
      return null;
   }
}

function listRecipes() {
   const dir = getRecipesDir();
   if (!fs.existsSync(dir)) return [];
   return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(function(f) {
         try {
            const recipe = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
            return {
               name: recipe.name,
               file: f,
               targetType: recipe.target ? recipe.target.type : null,
               score: recipe.score,
               author: recipe.author,
               createdAt: recipe.createdAt
            };
         } catch {
            return { name: f.replace('.json', ''), file: f };
         }
      })
      .sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
}

function deleteRecipe(name) {
   const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
   const filePath = path.join(getRecipesDir(), safeName + '.json');
   if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
   }
   return false;
}

// ---------------------------------------------------------------------------
// Export / Import (for sharing)
// ---------------------------------------------------------------------------

function exportRecipe(name, outputPath) {
   const recipe = loadRecipe(name);
   if (!recipe) return null;
   fs.writeFileSync(outputPath, JSON.stringify(recipe, null, 2));
   return outputPath;
}

function importRecipe(filePath) {
   if (!fs.existsSync(filePath)) return null;
   const recipe = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
   if (!recipe.name) {
      recipe.name = path.basename(filePath, '.json');
   }
   recipe.importedAt = new Date().toISOString();
   const savedPath = saveRecipe(recipe);
   return { recipe: recipe, path: savedPath };
}

// ---------------------------------------------------------------------------
// Build recipe from pipeline results
// ---------------------------------------------------------------------------

function buildRecipeFromResults(name, classification, linearResult, creativeResult, scoreResult, options) {
   const opts = options || {};

   return createRecipe(name, {
      description: opts.description,
      author: opts.author,
      targetName: classification && classification.target ? classification.target.name : null,
      targetType: classification && classification.target ? classification.target.type : null,
      profileName: classification && classification.profile ? classification.profile.name : null,
      stretch: classification && classification.profile ? classification.profile.stretch : null,
      combination: classification && classification.profile ? classification.profile.combination : null,
      processing: classification && classification.profile ? classification.profile.processing : null,
      linearSteps: linearResult ? linearResult.steps : [],
      creativeSteps: creativeResult ? creativeResult.steps : [],
      score: scoreResult ? { overall: scoreResult.overall, scores: scoreResult.scores, gatesPassed: scoreResult.gatesPassed } : null,
      equipment: opts.equipment,
      tags: opts.tags || []
   });
}

// ---------------------------------------------------------------------------
// Find recipes by target type
// ---------------------------------------------------------------------------

function findRecipesByType(targetType) {
   return listRecipes().filter(function(r) {
      return r.targetType === targetType;
   });
}

function findBestRecipeForType(targetType) {
   const candidates = findRecipesByType(targetType);
   if (candidates.length === 0) return null;

   // Pick the one with the highest score
   const scored = candidates.filter(function(r) { return r.score && r.score.overall; });
   if (scored.length === 0) return loadRecipe(candidates[0].name);

   scored.sort(function(a, b) { return (b.score.overall || 0) - (a.score.overall || 0); });
   return loadRecipe(scored[0].name);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function displayRecipe(recipe) {
   if (!recipe) {
      console.log('Recipe not found.');
      return;
   }

   console.log('Recipe: ' + recipe.name);
   if (recipe.description) console.log(recipe.description);
   console.log('');

   if (recipe.target && recipe.target.name) {
      console.log('Target: ' + recipe.target.name + ' (' + (recipe.target.type || 'unknown') + ')');
   }

   if (recipe.profile) {
      console.log('Profile: ' + (recipe.profile.name || 'custom'));
      if (recipe.profile.stretch) console.log('  Stretch: ' + recipe.profile.stretch);
      if (recipe.profile.combination) console.log('  Combination: ' + recipe.profile.combination);
   }

   if (recipe.pipeline) {
      if (recipe.pipeline.linearSteps && recipe.pipeline.linearSteps.length > 0) {
         console.log('Linear steps: ' + recipe.pipeline.linearSteps.length);
      }
      if (recipe.pipeline.creativeSteps && recipe.pipeline.creativeSteps.length > 0) {
         console.log('Creative steps: ' + recipe.pipeline.creativeSteps.length);
      }
   }

   if (recipe.score) {
      console.log('Score: ' + recipe.score.overall + '/100' +
         (recipe.score.gatesPassed ? ' (all gates passed)' : ' (some gates failed)'));
   }

   if (recipe.author) console.log('Author: ' + recipe.author);
   if (recipe.tags && recipe.tags.length > 0) console.log('Tags: ' + recipe.tags.join(', '));
   console.log('Created: ' + recipe.createdAt);
}

module.exports = {
   createRecipe,
   saveRecipe,
   loadRecipe,
   listRecipes,
   deleteRecipe,
   exportRecipe,
   importRecipe,
   buildRecipeFromResults,
   findRecipesByType,
   findBestRecipeForType,
   displayRecipe
};
